from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import asyncio
import json
import time
import logging
from typing import List

import websockets

app = FastAPI()
logger = logging.getLogger("heimdall")
logging.basicConfig(level=logging.INFO)


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


if __name__ == "__main__":
	import uvicorn

	uvicorn.run(app, host="0.0.0.0", port=8000)
 
