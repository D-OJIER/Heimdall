FROM node:18-bullseye-slim

# Install lightweight deps required for some node native modules (if needed)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies (use npm ci if lockfile present)
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Copy source
COPY . .

# Expose Vite default dev port and React dev server port if used
EXPOSE 5173 3000

# Default to dev server; use environment variable or override CMD in compose as needed
CMD ["sh", "-c", "npm run dev -- --host 0.0.0.0"]
