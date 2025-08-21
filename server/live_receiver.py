"""Live receiver WebSocket server

This FastAPI app exposes a WebSocket endpoint at /ws/live that accepts JSON messages
containing `frame_id` and `image_b64` (data URL or raw base64). For each incoming frame
it runs inference using the helper functions and loaded model(s) from `main.py`, draws
overlay boxes on the image, then returns a JSON message with detections and an
annotated image (base64 JPEG data URL).

Run with:
    uvicorn live_receiver:app --host 0.0.0.0 --port 8001

Client message format (text JSON):
    { "frame_id": "frame-1", "image_b64": "data:image/jpeg;base64,..." }

Server response format (text JSON):
    {
      "frame_id": "frame-1",
      "capture_ts": 169...,     # ms
      "inference_ts": 169...,   # ms
      "detections": [ {label, score, xmin,ymin,xmax,ymax}, ... ],
      "annotated_b64": "data:image/jpeg;base64,..."
    }

This file intentionally re-uses preprocessing and NMS helpers from `main.py` to
keep model/load logic consistent with the existing server.
"""

import base64
import io
import json
import time
import asyncio
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from PIL import Image, ImageDraw
import numpy as np

import main as model_main

app = FastAPI()


def decode_b64_image(b64: str) -> bytes:
    if b64.startswith('data:'):
        b64 = b64.split(',', 1)[1]
    try:
        return base64.b64decode(b64)
    except Exception:
        # try to be forgiving about spaces
        return base64.b64decode(b64.replace(' ', '+'))


def draw_detections_on_pil(raw_bytes: bytes, detections: list, show_label: bool = True) -> bytes:
    im = Image.open(io.BytesIO(raw_bytes)).convert('RGB')
    draw = ImageDraw.Draw(im)
    w, h = im.size
    for d in detections:
        xmin = int(d['xmin'] * w)
        ymin = int(d['ymin'] * h)
        xmax = int(d['xmax'] * w)
        ymax = int(d['ymax'] * h)
        # box
        draw.rectangle([xmin, ymin, xmax, ymax], outline=(255, 0, 0), width=2)
        if show_label:
            label = f"{d['label']} {d['score']:.2f}"
            text_size = draw.textsize(label)
            draw.rectangle([xmin, ymin - text_size[1] - 4, xmin + text_size[0] + 4, ymin], fill=(255, 0, 0))
            draw.text((xmin + 2, ymin - text_size[1] - 2), label, fill=(255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, format='JPEG', quality=80)
    return buf.getvalue()


async def ensure_model_loaded():
    # Ensure ONNX or PT model is loaded (mirrors logic in main.py)
    if model_main.onnx_session is not None or model_main.torch_model is not None:
        return
    model_path = model_main.find_onnx_model()
    if model_path:
        model_main.onnx_session = model_main.load_onnx_model(model_path)
        if model_main.onnx_session is not None:
            model_main.loaded_model_type = 'onnx'
            model_main.loaded_model_path = model_path
            return
    # try PT fallback
    pt = model_main.find_pt_model()
    if pt:
        try:
            import torch
            from models.experimental import attempt_load
            model_main.torch_model = attempt_load(pt, map_location='cpu')
            model_main.torch_model.eval()
            model_main.loaded_model_type = 'pt'
            model_main.loaded_model_path = pt
        except Exception:
            model_main.torch_model = None


async def run_inference_on_bytes(raw: bytes) -> list:
    # Preprocess
    try:
        img_arr, orig_w, orig_h, r, dw, dh = model_main.preprocess_image_bytes(raw, img_size=model_main.model_input_size)
    except Exception as e:
        raise RuntimeError(f'preprocess failed: {e}')

    dets = []
    # ONNX
    if model_main.onnx_session is not None:
        input_name = model_main.onnx_session.get_inputs()[0].name
        outputs = model_main.onnx_session.run(None, {input_name: img_arr})
        preds = None
        for out in outputs:
            if isinstance(out, np.ndarray) and out.ndim == 3:
                preds = out[0]
                break
        if preds is None:
            preds = outputs[0][0]
        dets = model_main.non_max_suppression(preds, conf_thres=model_main.conf_threshold, iou_thres=model_main.iou_threshold)
    # PT
    elif model_main.torch_model is not None:
        try:
            import torch
            inp = torch.from_numpy(img_arr).to('cpu')
            with torch.no_grad():
                y = model_main.torch_model(inp)
            if isinstance(y, (list, tuple)):
                y0 = y[0]
            else:
                y0 = y
            preds = y0.detach().cpu().numpy()
            if preds.ndim == 3:
                preds = preds[0]
            elif preds.ndim == 2:
                preds = preds
            else:
                preds = preds.reshape(-1, preds.shape[-1])
            dets = model_main.non_max_suppression(preds, conf_thres=model_main.conf_threshold, iou_thres=model_main.iou_threshold)
        except Exception as e:
            raise RuntimeError(f'pt inference failed: {e}')
    else:
        # no model
        return []

    # Map boxes back to original image space and normalize
    detections = []
    for d in dets:
        x1, y1, x2, y2, score, cls = d
        x1 = max(0, (x1 - dw) / r)
        x2 = max(0, (x2 - dw) / r)
        y1 = max(0, (y1 - dh) / r)
        y2 = max(0, (y2 - dh) / r)
        xmin = x1 / orig_w
        ymin = y1 / orig_h
        xmax = x2 / orig_w
        ymax = y2 / orig_h
        label = model_main.COCO_NAMES[int(cls)] if int(cls) < len(model_main.COCO_NAMES) else str(int(cls))
        detections.append({'label': label, 'score': float(score), 'xmin': float(xmin), 'ymin': float(ymin), 'xmax': float(xmax), 'ymax': float(ymax)})
    return detections


@app.websocket('/ws/live')
async def websocket_live(ws: WebSocket):
    await ws.accept()
    await ensure_model_loaded()
    try:
        while True:
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
            except Exception:
                await ws.send_text(json.dumps({'error': 'invalid json'}))
                continue

            frame_id = data.get('frame_id', 'frame')
            b64 = data.get('image_b64')
            if not b64:
                await ws.send_text(json.dumps({'error': 'image_b64 missing', 'frame_id': frame_id}))
                continue

            try:
                raw = decode_b64_image(b64)
            except Exception as e:
                await ws.send_text(json.dumps({'error': 'base64 decode failed', 'detail': str(e), 'frame_id': frame_id}))
                continue

            start = int(time.time() * 1000)
            try:
                detections = await run_inference_on_bytes(raw)
            except Exception as e:
                await ws.send_text(json.dumps({'error': 'inference failed', 'detail': str(e), 'frame_id': frame_id}))
                continue
            inf_time = int(time.time() * 1000)

            # draw annotated image
            try:
                annotated = draw_detections_on_pil(raw, detections, show_label=True)
                annotated_b64 = 'data:image/jpeg;base64,' + base64.b64encode(annotated).decode('ascii')
            except Exception as e:
                annotated_b64 = None

            out = {
                'frame_id': frame_id,
                'capture_ts': start,
                'inference_ts': inf_time,
                'detections': detections,
                'annotated_b64': annotated_b64
            }
            await ws.send_text(json.dumps(out))

    except WebSocketDisconnect:
        return


if __name__ == '__main__':
    import uvicorn
    uvicorn.run('live_receiver:app', host='0.0.0.0', port=8001, log_level='info')
