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

## Simple start (recommended)

If you want a minimal, copy-paste set of commands to get running quickly, use one of the flows below from Windows PowerShell.

Server mode (receiver + signaling + frontend expecting server inference):

```powershell
cd C:\VS_Programs\Heimdall\server
# activate venv (if you use one)
. \.venv\Scripts\Activate.ps1
python -m uvicorn live_receiver:app --host 0.0.0.0 --port 8001 --log-level info

# in another terminal
cd C:\VS_Programs\Heimdall\server
npm run start

# in the frontend terminal
cd C:\VS_Programs\Heimdall\frontend
$env:VITE_MODE='server'; npm run dev -- --host
```

WASM mode (client-side TFJS WASM inference in browser):

```powershell
cd C:\VS_Programs\Heimdall\frontend
npm install @tensorflow/tfjs-backend-wasm
New-Item -ItemType Directory -Force -Path .\public\wasm
Copy-Item -Path .\node_modules\@tensorflow\tfjs-backend-wasm\dist\*.wasm -Destination .\public\wasm -Force

cd C:\VS_Programs\Heimdall\frontend
$env:VITE_MODE=""  # clear server mode
npm run dev -- --host

# in another terminal (signaling server)
cd C:\VS_Programs\Heimdall\server
npm run start
```

Build/export YOLOv5 models (download weights, export ONNX / TorchScript):

```powershell
# from repo root
.\scripts\build-yolov5-models.ps1 -Model yolov5n -Device cpu -Opset 17 -Dynamic -Simplify

# defaults: Model=yolov5n, Device=cpu, Opset=17
```

Notes:
- The `build-yolov5-models.ps1` script creates/uses `server/.venv`, installs `server/yolov5/requirements.txt`, downloads the requested weights into `server/yolov5/` and runs `export.py` to produce `.onnx` and `torchscript` exports.
- If you prefer one-command helpers, `frontend/package.json` now includes `npm run start:server-mode` and `npm run start:wasm-mode` which invoke helper PowerShell scripts in `scripts/` (Windows).

Phone / remote join (quick)

When running the frontend dev server locally you can join from a phone on the same LAN via the machine's LAN IP and port (Vite default 5173 or React start port 3000). Example:

1) Find the host IP (PowerShell):

```powershell
ipconfig | Select-String 'IPv4' | Select-String -NotMatch '127.0.0.1'
```

2) Visit on your phone browser (replace IP):

```
http://192.168.1.42:5173
```

3) Generate a quick QR code in terminal (requires `npx qrcode-terminal`):

```powershell
cd C:\VS_Programs\Heimdall\frontend
npx qrcode-terminal "http://192.168.1.42:5173"
```

4) Alternatively use `ngrok` to expose the frontend to the internet and get a short URL (install ngrok separately):

```powershell
# expose port 5173
ngrok http 5173
# open the http forwarding URL shown by ngrok on your phone
```

Note: when using `ngrok` or other tunneling services, ensure any signaling server URLs or WebRTC STUN/TURN hosts are reachable by clients. If you run the signaling server locally, consider running it inside the same docker-compose so the frontend can reach it via the defined internal DNS name.

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

## Start modes

This project can run in two primary modes: a server-backed inference mode ("server mode") and a client-side WebAssembly (WASM) inference mode ("WASM mode"). Below are the explicit PowerShell commands for starting each mode on Windows with an activated Python virtual environment where relevant.

### Server mode (use server-side inference / receiver)

1) From the `server` folder, activate your virtualenv and start the FastAPI/receiver (example assumes `.venv` is activated):

```powershell
cd C:\VS_Programs\Heimdall\server
# Activate the virtualenv if not already active:
\.\.venv\Scripts\Activate.ps1
# Start the receiver with uvicorn
python -m uvicorn live_receiver:app --host 0.0.0.0 --port 8001 --log-level info
```

2) In the same `server` folder (or another terminal), start the signaling server (Node):

```powershell
cd C:\VS_Programs\Heimdall\server
npm run start
```

3) In the `frontend` folder, start the dev server in "server" mode so the frontend expects server-side detections:

```powershell
cd C:\VS_Programs\Heimdall\frontend
$env:VITE_MODE='server'; npm run dev -- --host
```

This sequence runs the Python receiver, the Node signaling server, and the frontend configured to use the server inference pipeline.

### WASM mode (client-side inference)

If you prefer to run inference in the browser using TFJS WASM backend, use these commands.

1) Ensure the WASM backend and `.wasm` assets are installed/copied (if not already):

```powershell
cd C:\VS_Programs\Heimdall\frontend
npm install @tensorflow/tfjs-backend-wasm
New-Item -ItemType Directory -Force -Path .\public\wasm
Copy-Item -Path .\node_modules\@tensorflow\tfjs-backend-wasm\dist\*.wasm -Destination .\public\wasm -Force
```

2) Start the frontend dev server with no `VITE_MODE` or with `VITE_MODE` cleared so it uses the client-side WASM pipeline:

```powershell
cd C:\VS_Programs\Heimdall\frontend
$env:VITE_MODE=""  # clear server mode
npm run dev -- --host
```

3) Start the signaling server so the app can still connect for WebRTC/signaling (Node):

```powershell
cd C:\VS_Programs\Heimdall\server
npm run start
```

If you previously set `VITE_TFJS_BACKEND` for WASM, verify in the browser console after the model loads with `tf.getBackend()` which should return `wasm`.

### Notes

- Use PowerShell on Windows as shown above; when running multiple commands on one line we use `;` where necessary. The examples assume relative paths from the repository root.
- If you use the project's provided `server` docker-compose or other Docker setups, you can run both the signaling and (optionally) the inference worker in containers instead of locally.

### Running the worker in Docker (recommended on Windows)

If you want to run both signaling and inference together using Docker Compose, create a `server/docker-compose.yml` and run it. A sample `docker-compose.yml` is included in the `server/` folder.


## Troubleshooting

- Port conflicts: ensure `3000` and `8000` are free or change mappings in `docker-compose.yml`.
- If Python dependencies fail to install (onnxruntime), check platform-specific wheels or use a matching Python version.
- If WebRTC connections fail, confirm both clients can reach the signaling server (check browser console/network and `signaling.js` logs).

## Next steps / TODOs

- Add tests and CI for frontend and server.
- Add a simple README section describing the API endpoints implemented in `main.py`.
- Optional: consolidate signaling into the FastAPI app or document how to run both signaling and API together behind a single reverse proxy.

## Node.js inference worker (optional)

You can run an all-JavaScript inference worker that connects to the signaling server, accepts frame images (base64), runs COCO-SSD using `@tensorflow/tfjs-node`, and sends detection messages back through the signaling WebSocket.

1) Install server deps (this will include tfjs-node and coco-ssd):

```powershell
cd C:\VS_Programs\Heimdall\server
npm install
```

2) Start the signaling server (if not already running):

```powershell
node signaling.js
```

3) Start the inference worker (in a separate terminal):

```powershell
npm run inference
```

By default the worker connects to `ws://localhost:8080`. You can override with `SIGNALING_URL` environment variable.

Message contract for frames the worker expects (example format):

```json
{ "type": "frame", "payload": { "frame_id": "123", "image_b64": "data:image/jpeg;base64,..." } }
```

The worker sends back a `detection` message with the normalized detection JSON (same contract used by clients). The signaling server will add `recv_ts` before broadcasting.

### Running the worker in Docker (recommended on Windows)

If `@tensorflow/tfjs-node` native bindings fail to load on Windows, run the worker in a Linux container where prebuilt binaries are available:

```powershell
# Build image (from repo root)
docker build -f server/Dockerfile -t heimdall-inference:latest ./server

# Run container and connect to local signaling server
docker run --rm -e SIGNALING_URL=ws://host.docker.internal:8080 heimdall-inference:latest
```

On Linux or macOS you can use `ws://host.docker.internal:8080` or the host IP as appropriate.

### Alternative: use Node LTS (18/20)

`@tensorflow/tfjs-node` often provides prebuilt binaries for Node LTS releases. If you're on Node 22 and the binary is not available, consider switching to Node 18 or 20 with `nvm`/`nvm-windows` and re-running `npm install`.
