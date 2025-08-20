# Heimdall — Minimal README

Short demo: phone camera → WebRTC → receiver with overlayed detections and a small signaling server.

## Prerequisites
- Node.js (16+), npm
- Python 3.8+ (optional, for FastAPI)

## Quick start — native
1) Start signaling server:

```powershell
cd C:\VS_Programs\Heimdall\server
npm install
node signaling.js
```

2) Start frontend (in another terminal):

```powershell
cd C:\VS_Programs\Heimdall\frontend
npm install
npm run dev
```

3) (Optional) Start FastAPI inference server:

```powershell
cd C:\VS_Programs\Heimdall\server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

docker-compose up --build

Detection JSON contract (server → client)
Per-frame message (coordinates normalized to [0..1]):

```json
{
	"frame_id": "string_or_int",
	"capture_ts": 1690000000000,
	"recv_ts": 1690000000100,
	"inference_ts": 1690000000120,
	"detections": [
		{ "label": "person", "score": 0.93, "xmin": 0.12, "ymin": 0.08, "xmax": 0.34, "ymax": 0.67 }
	]
}
```

Where to look
- `frontend/src/components/ObjectDetection.jsx` — capture, detection, send normalized detections
- `frontend/src/components/WebRTCHandler.jsx` — WebRTC datachannel + signaling WS handling
- `server/signaling.js` — validates detection payloads and stamps `recv_ts`

If you want targeted routing, ACKs, or a UI status for backend & latency, tell me which and I will add it.

## Scripts

- Frontend: `npm run dev`, `npm run build`, `npm run preview`, `npm run lint`
- Server (Node signalling): `npm run start` (runs `signaling.js`)
- Docker Compose: `docker-compose up --build`

## WASM mode (optional)
To run client-side detection using TFJS WASM backend follow these steps:

1) Install wasm backend in the frontend folder:

```powershell
cd C:\VS_Programs\Heimdall\frontend
npm install @tensorflow/tfjs-backend-wasm
```

2) Copy wasm binaries so they are served at `/wasm/`:

```powershell
New-Item -ItemType Directory -Force -Path .\frontend\public\wasm
Copy-Item -Path .\frontend\node_modules\@tensorflow\tfjs-backend-wasm\dist\*.wasm -Destination .\frontend\public\wasm -Force
```

3) Start the dev server requesting WASM for this run:

```powershell
$env:VITE_TFJS_BACKEND = 'wasm'; npm run dev
```

4) Verify in the browser console after the model loads:

```js
tf.getBackend(); // should return 'wasm'
```

If the wasm files 404 or `tf.getBackend()` returns another backend, check that the `.wasm` files exist in `frontend/public/wasm` and restart the dev server.

## Troubleshooting

- Port conflicts: ensure `3000` and `8000` are free or change mappings in `docker-compose.yml`.
- If Python dependencies fail to install (onnxruntime), check platform-specific wheels or use a matching Python version.
- If WebRTC connections fail, confirm both clients can reach the signaling server (check browser console/network and `signaling.js` logs).

## Next steps / TODOs

- Add tests and CI for frontend and server.
- Add a simple README section describing the API endpoints implemented in `main.py`.
- Optional: consolidate signaling into the FastAPI app or document how to run both signaling and API together behind a single reverse proxy.