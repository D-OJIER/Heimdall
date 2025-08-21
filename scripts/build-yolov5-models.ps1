<#
Build YOLOv5 models: download weights, create virtualenv, install deps, export to ONNX and TorchScript.

Usage examples (PowerShell):
# From repo root
.\scripts\build-yolov5-models.ps1 -Model yolov5n -Device cpu -Opset 17 -Dynamic -Simplify

Parameters:
-Model: model name without extension (e.g. yolov5n, yolov5s). Default: yolov5n
-Device: 'cpu' or GPU index like '0'. Default: cpu
-Opset: ONNX opset version. Default: 17
-Dynamic: switch to enable dynamic axes for ONNX
-Simplify: switch to run ONNX simplifier after export
-VenvPath: path to venv to create/use (default: server/.venv)
-YoloDir: path to local YOLOv5 directory (default: server/yolov5)
#>
[CmdletBinding()]
param(
    [string]$Model = 'yolov5n',
    [string]$Device = 'cpu',
    [int]$Opset = 17,
    [switch]$Dynamic,
    [switch]$Simplify,
    [string]$VenvPath = "server/.venv",
    [string]$YoloDir = "server/yolov5"
)

function Write-Log($msg) { Write-Host "[build-yolov5] $msg" -ForegroundColor Cyan }

$RepoRoot = (Resolve-Path .).Path
$VenvFull = Join-Path $RepoRoot $VenvPath
$YoloFull = Join-Path $RepoRoot $YoloDir

if (-not (Test-Path $YoloFull)) {
    Write-Error "YOLOv5 directory '$YoloFull' not found. Clone https://github.com/ultralytics/yolov5 into $YoloFull"
    exit 1
}

# Ensure Python exists
$pythonExe = "python"
try {
    $pyv = & $pythonExe --version 2>&1
    Write-Log "Found Python: $pyv"
} catch {
    Write-Error "Python not found on PATH. Please install Python 3.8+ and try again."
    exit 1
}

# Create venv if missing
if (-not (Test-Path $VenvFull)) {
    Write-Log "Creating virtual environment at '$VenvFull'..."
    & $pythonExe -m venv $VenvFull
    if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create venv"; exit 1 }
} else {
    Write-Log "Using existing virtualenv at '$VenvFull'"
}

# Activate venv
$activate = Join-Path $VenvFull 'Scripts\Activate.ps1'
if (-not (Test-Path $activate)) {
    Write-Error "Activate script not found at '$activate'"
    exit 1
}

Write-Log "Activating venv..."
. $activate

# Upgrade pip
Write-Log "Upgrading pip..."
& "$VenvFull\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel

# Install YOLOv5 requirements
$requirements = Join-Path $YoloFull 'requirements.txt'
if (Test-Path $requirements) {
    Write-Log "Installing YOLOv5 requirements from $requirements (may take a while)..."
    & "$VenvFull\Scripts\python.exe" -m pip install -r $requirements
    if ($LASTEXITCODE -ne 0) { Write-Error "Failed to install requirements"; exit 1 }
} else {
    Write-Log "requirements.txt not found in $YoloFull, continuing..."
}

# Install ONNX tooling
Write-Log "Installing export packages: onnx, onnx-simplifier, onnxruntime"
& "$VenvFull\Scripts\python.exe" -m pip install onnx onnx-simplifier onnxruntime
if ($LASTEXITCODE -ne 0) { Write-Log "Warning: installing onnx/onnxruntime failed." }

# Prepare weights path
$weightsName = "$Model.pt"
$weightsPath = Join-Path $YoloFull $weightsName

if (-not (Test-Path $weightsPath)) {
    $url = "https://github.com/ultralytics/yolov5/releases/latest/download/$weightsName"
    Write-Log "Downloading weights '$weightsName' from $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $weightsPath -UseBasicParsing -ErrorAction Stop
        Write-Log "Downloaded $weightsName"
    } catch {
        Write-Log "WebRequest failed, fallback to Python urllib..."
        $pyDownload = @"
import os
from urllib.request import urlretrieve
url = '$url'
out = r'$weightsPath'
print(f'Downloading {url} -> {out}')
urlretrieve(url, out)
print('Done')
"@
        $tmpPy = [IO.Path]::GetTempFileName() + '.py'
        $pyDownload | Out-File -FilePath $tmpPy -Encoding UTF8
        & "$VenvFull\Scripts\python.exe" $tmpPy
        Remove-Item $tmpPy -Force
        if (-not (Test-Path $weightsPath)) { Write-Error "Failed to download weights"; exit 1 }
    }
} else {
    Write-Log "Weights already exist at $weightsPath"
}

# Run export.py
Push-Location $YoloFull
try {
    $include    = 'onnx torchscript'
    $dynamicArg = if ($Dynamic) { '--dynamic' } else { '' }
    $simplifyArg= if ($Simplify) { '--simplify' } else { '' }

    $cmd = "`"$VenvFull\Scripts\python.exe`" export.py --weights `"$weightsPath`" --include $include --opset $Opset --device $Device $dynamicArg $simplifyArg"
    Write-Log "Running export: $cmd"
    iex $cmd
    if ($LASTEXITCODE -ne 0) { Write-Error "Export failed with code $LASTEXITCODE"; Pop-Location; exit 1 }
} finally {
    Pop-Location
}

# Check ONNX outputs
$onnxFiles = Get-ChildItem -Path $YoloFull -Filter "*.onnx" -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
if ($onnxFiles) {
    Write-Log "Exported ONNX files:"
    $onnxFiles | ForEach-Object { Write-Host "  $_" -ForegroundColor Green }
} else {
    Write-Log "No ONNX files found. Check export.py output."
}

Write-Log "Done. To activate venv later: & '$VenvFull\Scripts\Activate.ps1'"
Write-Log "TorchScript + ONNX exports should now be ready."
