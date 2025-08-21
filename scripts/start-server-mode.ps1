# Start the project in Server mode (opens three PowerShell windows):
# 1) Python receiver (uvicorn) with venv activation if present
# 2) Node signaling server (npm run start)
# 3) Frontend dev server with VITE_MODE='server'

Write-Host "Starting Heimdall in server mode (three separate PowerShell windows)..." -ForegroundColor Cyan

$repoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$server    = Join-Path $repoRoot 'server'
$frontend  = Join-Path $repoRoot 'frontend'

# 1) Start uvicorn (receiver API)
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$server'; 
     if (Test-Path '.\.venv\Scripts\Activate.ps1') { .\.venv\Scripts\Activate.ps1 }; 
     python -m uvicorn live_receiver:app --host 0.0.0.0 --port 8001 --log-level info"
)

# 2) Start signaling server (Node)
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$server'; 
     npm run start"
)

# 3) Start frontend dev server with VITE_MODE=server
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$frontend'; 
     `$env:VITE_MODE='server'; 
     npm run dev -- --host"
)

Write-Host "Launched server-mode windows. Check each window for logs/errors." -ForegroundColor Green
