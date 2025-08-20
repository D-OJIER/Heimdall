#!/usr/bin/env bash
set -euo pipefail

# MODE selection: env MODE overrides positional arg; default to 'wasm'
MODE="${MODE:-${1:-wasm}}"
echo "Mode => $MODE"

# Resolve to absolute project root
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Ensure frontend deps are installed (skip if node_modules exists)
echo "Checking frontend dependencies..."
cd "$ROOT_DIR/frontend"
if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..."
  npm install
else
  echo "node_modules present — skipping frontend npm install"
fi

cleanup() {
  echo "Cleanup: stopping child processes..."
  if [ -n "${SIG_PID-}" ] && kill -0 "$SIG_PID" >/dev/null 2>&1; then
    kill "$SIG_PID" || true
  fi
}
trap cleanup INT TERM EXIT

if [ "$MODE" = "wasm" ]; then
  echo "Starting frontend in WASM mode..."
  # Use cross-platform npm script which sets VITE_TFJS_BACKEND for Windows shells too
  # Ensure cross-env is installed (node_modules may exist but dev deps may not be present)
  cd "$ROOT_DIR/frontend"
  if [ ! -f node_modules/.bin/cross-env ] && [ ! -f node_modules/.bin/cross-env.cmd ]; then
    echo "cross-env not found — installing cross-env as a devDependency..."
    npm install --no-audit --no-fund --save-dev cross-env
  fi

  npm run dev:wasm
else
  echo "Starting in server mode: signaling + frontend (local)"

  # Install server deps if needed
  cd "$ROOT_DIR/server"
  if [ ! -d node_modules ]; then
    echo "Installing server dependencies..."
    npm install
  else
    echo "node_modules present in server — skipping server npm install"
  fi

  echo "Starting signaling server in background..."
  node signaling.js &
  SIG_PID=$!

  # Return to frontend and start dev server
  cd "$ROOT_DIR/frontend"
  echo "Starting frontend (default backend)..."
  npm run dev
fi
