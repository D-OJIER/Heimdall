FROM python:3.10-slim

WORKDIR /app

# system deps for some Python packages
RUN apt-get update && apt-get install -y --no-install-recommends gcc build-essential && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt ./
RUN python -m pip install --upgrade pip setuptools wheel
RUN pip install --no-cache-dir -r requirements.txt

# Copy server source
COPY . .

# Expose receiver port
EXPOSE 8001

# Default command to run the FastAPI receiver
CMD ["uvicorn", "live_receiver:app", "--host", "0.0.0.0", "--port", "8001", "--log-level", "info"]
