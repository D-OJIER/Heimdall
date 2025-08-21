# Start the project in WASM mode (three PowerShell windows):
# 1) Frontend dev server with VITE_MODE cleared
# 2) Node signaling server (npm run start)
# Optionally copies wasm assets if missing

Write-Host "Starting Heimdall in WASM mode (frontend + signaling)..." -ForegroundColor Cyan

$repoRoot  = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$server    = Join-Path $repoRoot 'server'
$frontend  = Join-Path $repoRoot 'frontend'

# Ensure wasm assets exist (attempt to copy if node_modules present)
$wasmDest = Join-Path $frontend 'public\wasm'
$wasmSrc  = Join-Path $frontend 'node_modules\@tensorflow\tfjs-backend-wasm\dist'

if (-not (Test-Path $wasmDest)) {
    New-Item -ItemType Directory -Force -Path $wasmDest | Out-Null
}

if ((Test-Path $wasmSrc) -and (Get-ChildItem -Path $wasmSrc -Filter '*.wasm' -ErrorAction SilentlyContinue)) {
    Copy-Item -Path (Join-Path $wasmSrc '*.wasm') -Destination $wasmDest -Force
}

# 1) Start frontend dev server (VITE_MODE cleared)
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$frontend'; 
     Remove-Item Env:VITE_MODE -ErrorAction SilentlyContinue; 
     npm run dev -- --host"
)

# 2) Start signaling server (Node)
Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$server'; 
     npm run start"
)

Write-Host "Launched wasm-mode windows. Check each window for logs/errors." -ForegroundColor Green
