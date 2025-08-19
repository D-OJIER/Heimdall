# Heimdall

Lightweight WebRTC demo + inference server. This repository contains a React + Vite frontend that uses WebRTC (via `simple-peer`) and QR codes for connection/setup, a Node-based signalling helper (`signaling.js`), and a Python FastAPI service intended for model/inference work (see `server/requirements.txt`). A `docker-compose.yml` is provided for easy local orchestration.

## Project layout

- `frontend/` — React + Vite frontend
  - `src/` — application source (entry: `main.jsx`, main component: `App.jsx`, `components/WebRTCHandler.jsx`)
  - `package.json` — frontend deps and scripts (`dev`, `build`, `preview`, `lint`)
- `server/` — backend code
  - `main.py` — FastAPI app (API / inference entrypoint)
  - `signaling.js` — Node-based signaling server for WebRTC (uses `express`, `ws`)
  - `package.json` — Node dependencies and `start` script for `signaling.js`
  - `requirements.txt` — Python deps for FastAPI/uvicorn/onnxruntime
- `Dockerfile`, `docker-compose.yml` — containerized setup for `frontend` and `server`
- `bench/` — benchmark scripts

## Requirements

- Node.js and `npm` (frontend and signaling): recent LTS (16+ recommended)
- Python 3.8+ (for FastAPI/onnxruntime)
- Optionally Docker & Docker Compose to run services in containers

## Quick start — development (native)

1. Start the frontend

	Open a terminal, then:

	```powershell
	cd frontend
	npm install
	npm run dev
	```

	The Vite dev server will serve the app (default port shown in the terminal; Docker config maps `3000`).

2. Run the Node signalling server (WebSocket helper)

	```powershell
	cd server
	npm install
	npm run start
	```

	This runs `signaling.js` (uses `express` + `ws`). By default the repository is set up to run the FastAPI server separately below.

3. Run the FastAPI app (Python)

	```powershell
	cd server
	python -m venv .venv
	.\.venv\Scripts\Activate.ps1
	pip install -r requirements.txt
	uvicorn main:app --host 0.0.0.0 --port 8000
	```

	The API will be reachable on port `8000` (see `docker-compose.yml` mapping).

## Quick start — Docker (recommended for isolated runs)

Build and start both services using Docker Compose:

```powershell
docker-compose up --build
```

Services exposed by the compose configuration:
- Frontend: `localhost:3000` -> Vite dev server
- Server (FastAPI): `localhost:8000`

Notes:
- The compose file mounts local `frontend/` and `server/` directories into the containers for live code edits during development.

## Where to look in the code

- Frontend entry: `frontend/src/main.jsx` and `frontend/src/App.jsx`
- WebRTC handling: `frontend/src/components/WebRTCHandler.jsx`
- Signaling: `server/signaling.js` (Node WebSocket server)
- API / inference: `server/main.py` (FastAPI), Python deps in `server/requirements.txt`
- Frontend dependencies: `frontend/package.json` (Vite, React, `simple-peer`, `qrcode.react`)

## Scripts

- Frontend: `npm run dev`, `npm run build`, `npm run preview`, `npm run lint`
- Server (Node signalling): `npm run start` (runs `signaling.js`)
- Docker Compose: `docker-compose up --build`

## Troubleshooting

- Port conflicts: ensure `3000` and `8000` are free or change mappings in `docker-compose.yml`.
- If Python dependencies fail to install (onnxruntime), check platform-specific wheels or use a matching Python version.
- If WebRTC connections fail, confirm both clients can reach the signaling server (check browser console/network and `signaling.js` logs).

## Next steps / TODOs

- Add tests and CI for frontend and server.
- Add a simple README section describing the API endpoints implemented in `main.py`.
- Optional: consolidate signaling into the FastAPI app or document how to run both signaling and API together behind a single reverse proxy.