#!/bin/bash
MODE=${MODE:-wasm}
if [ "$1" == "--ngrok" ]; then
  # Start ngrok for port 3000
  ngrok http 3000 &
fi

if [ "$MODE" == "wasm" ]; then
  echo "Starting in WASM mode (frontend only)..."
  cd frontend
  npm run dev
else
  echo "Starting in server mode (frontend + server)..."
  docker-compose up --build
fi