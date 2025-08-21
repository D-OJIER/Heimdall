# Inference worker container using Node 18 (LTS)
# Uses tfjs-node prebuilt binaries available on Linux

FROM node:18-bullseye-slim

# Install dependencies needed by some tfjs binaries (optional)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files first to leverage Docker cache
COPY package.json package-lock.json* ./

# Install production deps (includes @tensorflow/tfjs-node)
# Use `npm install --omit=dev` instead of `npm ci` because package-lock.json may not be present
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY . .

# Expose nothing explicitly; worker connects to external signaling server
CMD ["node", "inference_server.js"]
