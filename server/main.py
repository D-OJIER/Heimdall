from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import asyncio
import json
import time
import logging
from typing import List

import websockets
import os
import base64
import io
import numpy as np
from PIL import Image
import onnxruntime as ort
import importlib
import traceback
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
try:
	import psutil
except Exception:
	psutil = None

app = FastAPI()
logger = logging.getLogger("heimdall")
logging.basicConfig(level=logging.INFO)

# Allow CORS from frontend during development
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

# ONNX model/session globals
onnx_session = None
torch_model = None
loaded_model_type = None  # 'onnx' or 'pt' or None
loaded_model_path = None
model_input_size = 640
conf_threshold = 0.25
iou_threshold = 0.45
# COCO class names (80)
COCO_NAMES = [
	'person','bicycle','car','motorbike','aeroplane','bus','train','truck','boat','traffic light',
	'fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow',
	'elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee',
	'skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle',
	'wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange',
	'broccoli','carrot','hot dog','pizza','donut','cake','chair','sofa','pottedplant','bed',
	'diningtable','toilet','tvmonitor','laptop','mouse','remote','keyboard','cell phone','microwave','oven',
	'toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'
]


def load_onnx_model(path: str):
	global onnx_session
	if not os.path.exists(path):
		logger.warning('ONNX model not found at %s', path)
		return None
	try:
		logger.info('Loading ONNX model from %s', path)
		so = ort.SessionOptions()
		so.intra_op_num_threads = int(os.environ.get('ONNX_INTRA_THREADS', 1))
		so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
		sess = ort.InferenceSession(path, sess_options=so, providers=['CPUExecutionProvider'])
		logger.info('ONNX model loaded')
		return sess
	except Exception as e:
		logger.exception('Failed to load ONNX model: %s', e)
		return None


def find_onnx_model():
	# Search common locations for the exported yolov5n.onnx
	candidates = [
		os.path.join(os.getcwd(), 'models', 'yolov5n.onnx'),
		os.path.join(os.getcwd(), 'yolov5', 'yolov5n.onnx'),
		os.path.join(os.getcwd(), 'server', 'yolov5', 'yolov5n.onnx'),
	]
	for p in candidates:
		if os.path.exists(p):
			logger.info('Found ONNX model at %s', p)
			return p
	logger.warning('No ONNX model found in candidates: %s', candidates)
	return None


def find_pt_model():
	candidates = [
		os.path.join(os.getcwd(), 'yolov5', 'yolov5n.pt'),
		os.path.join(os.getcwd(), 'models', 'yolov5n.pt'),
		os.path.join(os.getcwd(), 'yolov5', 'weights', 'yolov5n.pt'),
	]
	for p in candidates:
		if os.path.exists(p):
			logger.info('Found PT model at %s', p)
			return p
	logger.debug('No PT model found in candidates: %s', candidates)
	return None


# Try to load model at startup if present
startup_model = find_onnx_model()
if startup_model:
	onnx_session = load_onnx_model(startup_model)
	if onnx_session is not None:
		loaded_model_type = 'onnx'
		loaded_model_path = startup_model
	else:
		# attempt PT fallback
		pt = find_pt_model()
		if pt:
			try:
				import torch
				from models.experimental import attempt_load
				logger.info('Loading PyTorch model from %s', pt)
				torch_model = attempt_load(pt, map_location='cpu')
				torch_model.eval()
				loaded_model_type = 'pt'
				loaded_model_path = pt
				logger.info('PyTorch model loaded')
			except Exception:
				logger.exception('Failed to load PT model')


def letterbox(im: Image.Image, new_shape=(640, 640), color=(114, 114, 114)):
	# Resize and pad image to meet new_shape while keeping aspect ratio
	shape = im.size[::-1]  # (h, w)
	r = min(new_shape[0] / shape[0], new_shape[1] / shape[1])
	new_unpad = (int(round(shape[1] * r)), int(round(shape[0] * r)))
	dw = new_shape[1] - new_unpad[0]
	dh = new_shape[0] - new_unpad[1]
	dw /= 2
	dh /= 2
	im_resized = im.resize(new_unpad, Image.BILINEAR)
	new_im = Image.new('RGB', (new_shape[1], new_shape[0]), color)
	new_im.paste(im_resized, (int(dw), int(dh)))
	return new_im, r, (dw, dh)


def preprocess_image_bytes(img_bytes: bytes, img_size=640):
	im = Image.open(io.BytesIO(img_bytes)).convert('RGB')
	orig_w, orig_h = im.size
	img, r, (dw, dh) = letterbox(im, new_shape=(img_size, img_size))
	img_arr = np.array(img).astype(np.float32)
	# normalize 0..1
	img_arr /= 255.0
	# HWC to CHW
	img_arr = np.transpose(img_arr, (2, 0, 1))
	img_arr = np.expand_dims(img_arr, 0).astype(np.float32)
	return img_arr, orig_w, orig_h, r, dw, dh


def xywh2xyxy(x):
	# x is [x_center, y_center, w, h]
	y = np.copy(x)
	y[0] = x[0] - x[2] / 2
	y[1] = x[1] - x[3] / 2
	y[2] = x[0] + x[2] / 2
	y[3] = x[1] + x[3] / 2
	return y


def non_max_suppression(predictions, conf_thres=0.25, iou_thres=0.45):
	# predictions: (N, 85) [x, y, w, h, conf, class_probs...]
	boxes = []
	if predictions is None:
		return []
	# filter by confidence
	scores = predictions[:, 4]
	mask = scores > conf_thres
	preds = predictions[mask]
	if preds.shape[0] == 0:
		return []
	results = []
	# convert to xyxy and compute class scores
	for det in preds:
		x_c, y_c, w, h = det[0:4]
		conf = det[4]
		class_probs = det[5:]
		class_id = int(np.argmax(class_probs))
		class_conf = class_probs[class_id]
		score = conf * class_conf
		if score < conf_thres:
			continue
		xyxy = xywh2xyxy(np.array([x_c, y_c, w, h]))
		results.append([xyxy[0], xyxy[1], xyxy[2], xyxy[3], float(score), class_id])

	if len(results) == 0:
		return []

	# perform NMS per class
	results = np.array(results)
	final = []
	for cls in np.unique(results[:, 5]):
		cls_mask = results[results[:, 5] == cls]
		# sort by score
		idxs = np.argsort(-cls_mask[:, 4])
		cls_boxes = cls_mask[idxs]
		keep = []
		while len(cls_boxes) > 0:
			box = cls_boxes[0]
			keep.append(box)
			if len(cls_boxes) == 1:
				break
			rest = cls_boxes[1:]
			# IoU
			x1 = np.maximum(box[0], rest[:, 0])
			y1 = np.maximum(box[1], rest[:, 1])
			x2 = np.minimum(box[2], rest[:, 2])
			y2 = np.minimum(box[3], rest[:, 3])
			inter_w = np.maximum(0, x2 - x1)
			inter_h = np.maximum(0, y2 - y1)
			inter = inter_w * inter_h
			area1 = (box[2] - box[0]) * (box[3] - box[1])
			area2 = (rest[:, 2] - rest[:, 0]) * (rest[:, 3] - rest[:, 1])
			union = area1 + area2 - inter
			iou = inter / (union + 1e-6)
			cls_boxes = rest[iou <= iou_thres]
		for k in keep:
			final.append(k.tolist())
	return final



class DetectionItem(BaseModel):
	label: str
	score: float = Field(..., ge=0.0, le=1.0)
	xmin: float = Field(..., ge=0.0, le=1.0)
	ymin: float = Field(..., ge=0.0, le=1.0)
	xmax: float = Field(..., ge=0.0, le=1.0)
	ymax: float = Field(..., ge=0.0, le=1.0)


class DetectionPayload(BaseModel):
	frame_id: str
	capture_ts: int
	inference_ts: int
	detections: List[DetectionItem]


class FramePayload(BaseModel):
	frame_id: str
	image_b64: str


async def forward_to_signaling(payload: dict, signaling_url: str = "ws://localhost:8080"):
	# Connect to signaling server as a short-lived publisher client
	try:
		async with websockets.connect(signaling_url) as ws:
			message = {"type": "detection", "payload": payload}
			await ws.send(json.dumps(message))
			logger.info("Published detection to signaling server")
	except Exception as e:
		logger.error("Failed to forward to signaling server: %s", e)
		raise


@app.post("/publish_detection")
async def publish_detection(payload: DetectionPayload):
	# Basic validation is handled by pydantic
	# Add recv_ts and forward to signaling server
	data = payload.dict()
	data["recv_ts"] = int(time.time() * 1000)
	try:
		await forward_to_signaling(data)
	except Exception as e:
		raise HTTPException(status_code=500, detail=str(e))
	return {"status": "ok", "recv_ts": data["recv_ts"]}


@app.post('/infer_frame')
async def infer_frame(payload: FramePayload):
	# Save incoming frame to disk for debug and optional ONNX/PT inference
	try:
		data = payload.dict()
		b64 = data.get('image_b64')
		if not b64:
			raise HTTPException(status_code=400, detail='image_b64 missing')

		# strip data URL prefix
		if b64.startswith('data:'):
			b64 = b64.split(',', 1)[1]

		# robust decode
		try:
			raw = base64.b64decode(b64)
		except Exception:
			try:
				cleaned = b64.replace(' ', '+')
				raw = base64.b64decode(cleaned)
			except Exception:
				logger.warning('Failed to base64-decode incoming image; preview first 120 chars: %s', b64[:120])
				raise

		# Optionally save incoming frames for debugging; disable in production for lower latency
		if os.environ.get('SAVE_FRAMES', '0') == '1':
			outdir = os.path.join(os.getcwd(), 'frames')
			os.makedirs(outdir, exist_ok=True)
			fname = os.path.join(outdir, f"{data.get('frame_id')}.jpg")
			with open(fname, 'wb') as f:
				f.write(raw)
			size = os.path.getsize(fname)
			logger.info('Saved incoming frame to %s (%d bytes)', fname, size)

		# run inference if a model is available (try ONNX then PT fallback)
		model_path = os.path.join(os.getcwd(), 'models', 'yolov5n.onnx')
		global onnx_session, model_input_size, conf_threshold, iou_threshold
		global torch_model, loaded_model_type

		# try to ensure onnx_session exists
		if onnx_session is None:
			onnx_session = load_onnx_model(model_path)
			if onnx_session is not None:
				loaded_model_type = 'onnx'
				loaded_model_path = model_path

		# try PT fallback if ONNX not loaded
		if onnx_session is None and torch_model is None:
			pt = find_pt_model()
			if pt:
				try:
					import torch
					from models.experimental import attempt_load
					logger.info('Attempting to load PT model from %s', pt)
					torch_model = attempt_load(pt, map_location='cpu')
					torch_model.eval()
					loaded_model_type = 'pt'
					loaded_model_path = pt
					logger.info('Loaded PT model for inference')
				except Exception:
					logger.exception('Failed to load PT model fallback')

		# No model loaded
		if onnx_session is None and torch_model is None:
			logger.info('No model loaded; saved frame only')
			return JSONResponse({'status': 'ok', 'message': 'frame saved; no model loaded'})

		# Preprocess
		try:
			img_arr, orig_w, orig_h, r, dw, dh = preprocess_image_bytes(raw, img_size=model_input_size)
		except Exception as e:
			logger.exception('Failed to preprocess image bytes: %s', e)
			return JSONResponse({'status': 'error', 'message': 'preprocess failed: ' + str(e)}, status_code=500)

		dets = []
		# ONNX inference
		if onnx_session is not None:
			try:
				input_name = onnx_session.get_inputs()[0].name
				outputs = onnx_session.run(None, {input_name: img_arr})
				preds = None
				for out in outputs:
					if isinstance(out, np.ndarray) and out.ndim == 3:
						preds = out[0]
						break
				if preds is None:
					preds = outputs[0][0]
				dets = non_max_suppression(preds, conf_thres=conf_threshold, iou_thres=iou_threshold)
			except Exception as e:
				logger.exception('ONNX inference failed: %s', e)
				return JSONResponse({'status': 'error', 'message': 'onnx inference failed: ' + str(e)}, status_code=500)

		# PT inference fallback
		elif torch_model is not None:
			try:
				import torch
				inp = torch.from_numpy(img_arr).to('cpu')
				with torch.no_grad():
					y = torch_model(inp)
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
				dets = non_max_suppression(preds, conf_thres=conf_threshold, iou_thres=iou_threshold)
			except Exception as e:
				logger.exception('PT inference failed: %s', e)
				return JSONResponse({'status': 'error', 'message': 'pt inference failed: ' + str(e)}, status_code=500)

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
			label = COCO_NAMES[int(cls)] if int(cls) < len(COCO_NAMES) else str(int(cls))
			detections.append({ 'label': label, 'score': float(score), 'xmin': float(xmin), 'ymin': float(ymin), 'xmax': float(xmax), 'ymax': float(ymax) })

		out_payload = {
			'frame_id': data.get('frame_id'),
			'capture_ts': int(time.time() * 1000),
			'inference_ts': int(time.time() * 1000),
			'detections': detections
		}
		try:
			await forward_to_signaling(out_payload)
		except Exception as e:
			logger.warning('Could not forward detections to signaling: %s', e)

		return JSONResponse({'status': 'ok', 'detections': detections})
	except Exception as e:
		logger.exception('Error in infer_frame: %s', e)
		raise HTTPException(status_code=500, detail=str(e))


@app.get('/model_status')
async def model_status():
	"""Return which model (ONNX or PT) is currently loaded and basic info."""
	info = {'loaded_model_type': loaded_model_type, 'loaded_model_path': loaded_model_path}
	# Add CPU usage if psutil available
	try:
		if psutil is not None:
			info['cpu_percent'] = psutil.cpu_percent(interval=0.1)
		else:
			# Fallback: try os.getloadavg on supported platforms and normalize
			try:
				load1, load5, load15 = os.getloadavg()
				# approximate percentage based on number of CPUs
				cpu_count = os.cpu_count() or 1
				info['cpu_percent'] = round((load1 / cpu_count) * 100, 1)
			except Exception:
				info['cpu_percent'] = None
	except Exception:
		info['cpu_percent_error'] = traceback.format_exc()
	try:
		if onnx_session is not None:
			inputs = onnx_session.get_inputs()
			outputs = onnx_session.get_outputs()
			info['onnx_inputs'] = [{ 'name': i.name, 'shape': i.shape, 'dtype': str(i.type) } for i in inputs]
			info['onnx_outputs'] = [{ 'name': o.name, 'shape': o.shape, 'dtype': str(o.type) } for o in outputs]
	except Exception:
		info['onnx_info_error'] = traceback.format_exc()
	try:
		if torch_model is not None:
			info['pt_loaded'] = True
			try:
				import torch
				# try to get number of parameters
				info['pt_num_params'] = sum(p.numel() for p in torch_model.parameters())
			except Exception:
				info['pt_info_error'] = traceback.format_exc()
	except Exception:
		info['model_status_error'] = traceback.format_exc()
	# Add a short model name for UI convenience
	try:
		if loaded_model_path:
			info['model_name'] = os.path.basename(loaded_model_path)
	except Exception:
		pass
	return JSONResponse(info)


if __name__ == "__main__":
	import uvicorn

	uvicorn.run(app, host="0.0.0.0", port=8000)
 
