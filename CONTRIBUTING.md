# Contributing & Local setup notes

This short guide explains where to place model files (ONNX / PyTorch) so the FastAPI server can load them, how to export an ONNX from the included `yolov5` code, and how to generate / serve the TFJS WASM binaries for the frontend.

Keep these points in mind:
- Large model files (ONNX / .pt) should generally NOT be committed to the repository; this project `.gitignore` intentionally excludes `server/models/*.onnx` and `server/models/*.pt`.
- The repo contains a `yolov5/` subdirectory with utilities you can use to export or work with weights locally.

## Where to place model files (server)

- Preferred ONNX path (server will search these locations at startup):
  - `./models/yolov5n.onnx`
  - `./yolov5/yolov5n.onnx`
  - `./server/yolov5/yolov5n.onnx`

- PyTorch (.pt) fallback search locations:
  - `./yolov5/yolov5n.pt`
  - `./models/yolov5n.pt`
  - `./yolov5/weights/yolov5n.pt`

If you drop the ONNX into one of the preferred locations, the server will attempt to load it automatically on startup. If ONNX is not present the server will attempt to load any `.pt` files it finds as a fallback.

## Exporting an ONNX from the included `yolov5` folder (example)

This repository includes a `yolov5/` directory with the usual `export.py` script. Example (PowerShell):

```powershell
cd C:\VS_Programs\Heimdall\server\yolov5
# make sure you have the yolov5 requirements installed (in a venv)
# Example export command (adjust weight name/path as required):
python export.py --weights yolov5n.pt --include onnx --img 640 --device cpu

# Move/copy the resulting .onnx to a location the server will find:
Copy-Item -Path .\yolov5n.onnx -Destination ..\models\yolov5n.onnx -Force
```

Notes:
- If exporting fails due to missing dependencies, create and activate a Python venv in `server/` and `pip install -r yolov5/requirements.txt` (some packages may be heavy).
- The exact `export.py` flags may vary by YOLO version; check `yolov5/export.py` for the arguments supported.

## Generating TFJS WASM binaries for the frontend (COCO-SSD/WASM)

The frontend expects WASM backend files served under `frontend/public/wasm/`. Steps (PowerShell):

```powershell
cd C:\VS_Programs\Heimdall\frontend
npm install @tensorflow/tfjs-backend-wasm
New-Item -ItemType Directory -Force -Path .\public\wasm
Copy-Item -Path .\node_modules\@tensorflow\tfjs-backend-wasm\dist\*.wasm -Destination .\public\wasm -Force
```

After copying the `.wasm` files restart the Vite dev server. The frontend will attempt to fetch `/wasm/tfjs-backend-wasm.wasm` and will use the WASM backend for COCO-SSD in local mode.

## Running locally (PowerShell commands)

1. Start the signaling server (Node):

```powershell
cd C:\VS_Programs\Heimdall\server
npm install
npm run start
```

2. (Optional) Start the FastAPI inference server (Python) if you plan to use server-mode YOLO:

```powershell
cd C:\VS_Programs\Heimdall\server
. .\.venv\Scripts\Activate.ps1      # create/activate venv first if needed
python -m pip install -r requirements.txt
# Optional: set ONNX performance threads
$env:ONNX_INTRA_THREADS = '2'
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

3. Start the frontend:

```powershell
cd C:\VS_Programs\Heimdall\frontend
npm install
# For WASM local detection
$env:VITE_TFJS_BACKEND = 'wasm'; npm run dev -- --host
# For server mode (YOLO on server)
$env:VITE_MODE = 'server'; npm run dev -- --host
```

Alternatively, you can use the `?mode=server` URL parameter in the browser to toggle server mode at runtime (e.g. `http://localhost:5173/?mode=server`).

## Verifying model loading and health

- Check the inference server (if running) with:
  ```powershell
  Invoke-RestMethod -Uri 'http://127.0.0.1:8000/model_status' -Method GET | ConvertTo-Json
  ```
  The endpoint returns `loaded_model_type`, `model_name`, and `cpu_percent` (if `psutil` is installed).

- In the frontend console you should see one of:
  - `TFJS backend set to WASM` and `COCO-SSD Model loaded successfully on backend wasm` in local mode
  - `Model: ONNX • yolov5n.onnx (YOLO)` in server mode once `model_status` reports an ONNX/PT file

## Debugging notes

- If WASM fails to load, ensure the `.wasm` files are present under `frontend/public/wasm` and restart the dev server.
- If the server reports `No model loaded`, check the `server/models` and `server/yolov5` paths for the ONNX/PT files and check the server logs for load errors.
- Use `SAVE_FRAMES=1` (environment variable) to have the server save incoming frames under `server/frames/` for debugging, but note this increases I/O.

## Committing model files

Large model binaries should not be committed to the repository. If you must version models, use an external model registry or an LFS-compatible flow and update `.gitattributes` appropriately.

---
Thank you — if you'd like I can add a small developer script (`scripts/export_onnx.ps1`) to automate the ONNX export+copy step for Windows.