<#
Export a YOLOv5 model to ONNX and copy it to the server models directory.

Usage (from repo root):
  powershell -ExecutionPolicy Bypass -File .\scripts\export_onnx.ps1 -Weights "yolov5n.pt" -Img 640 -Device cpu

Parameters:
  -Weights  : Path or filename of the .pt weights (default: yolov5n.pt)
  -Img      : Image size to export for (default: 640)
  -Device   : Device for export (cpu or 0 for GPU) (default: cpu)

Notes:
 - This script will try to use `server/.venv` Python if it exists. Otherwise it will use the system `python`.
 - The script assumes the standard `yolov5/export.py` exists under `server/yolov5`.
 - The resulting ONNX will be copied to `server/models/`.
#>

param(
  [string]$Weights = 'yolov5n.pt',
  [int]$Img = 640,
  [string]$Device = 'cpu'
)

set -e

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $scriptRoot '..')
$serverDir = Resolve-Path (Join-Path $repoRoot 'server')
$yoloDir = Resolve-Path (Join-Path $serverDir 'yolov5')
$modelsDir = Resolve-Path (Join-Path $serverDir 'models') -ErrorAction SilentlyContinue
if (-not $modelsDir) {
  New-Item -ItemType Directory -Path (Join-Path $serverDir 'models') | Out-Null
  $modelsDir = Resolve-Path (Join-Path $serverDir 'models')
}

# Determine Python executable: prefer server venv
$venvPython = Join-Path $serverDir '.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
  $python = $venvPython
  Write-Host "Using venv Python:$python"
} else {
  $python = 'python'
  Write-Host "Using system Python (ensure required packages are installed): $python"
}

# Resolve weights path: if file exists in provided path use it; otherwise look inside yolov5 dir
if (Test-Path $Weights) {
  $weightsPath = Resolve-Path $Weights
} else {
  $candidate = Join-Path $yoloDir $Weights
  if (Test-Path $candidate) { $weightsPath = Resolve-Path $candidate } else { $weightsPath = $Weights }
}

Write-Host "Exporting weights:" $weightsPath
Write-Host "YOLO dir:" $yoloDir

if (-not (Test-Path (Join-Path $yoloDir 'export.py'))) {
  Write-Error "export.py not found in $yoloDir. Make sure yolov5 is present under server/yolov5"
  exit 1
}

Push-Location $yoloDir
try {
  $args = @('--weights', "$weightsPath", '--include', 'onnx', '--img', "$Img", '--device', "$Device")
  Write-Host "Running: $python export.py $($args -join ' ')"
  & $python export.py @args
} catch {
  Write-Error "Export failed: $_"
  Pop-Location
  exit 2
}
Pop-Location

# Find the generated .onnx file (common name is same base as weights)
$onnxName = [System.IO.Path]::GetFileNameWithoutExtension($Weights) + '.onnx'
$possible = @(Join-Path $yoloDir $onnxName, Join-Path $repoRoot $onnxName, Join-Path $yoloDir 'weights' $onnxName)
$found = $null
foreach ($p in $possible) {
  if (Test-Path $p) { $found = Resolve-Path $p; break }
}

if (-not $found) {
  # search for any .onnx produced recently in yolov5 dir
  $candidates = Get-ChildItem -Path $yoloDir -Filter '*.onnx' -Recurse | Sort-Object LastWriteTime -Descending
  if ($candidates -and $candidates.Count -gt 0) { $found = $candidates[0].FullName }
}

if (-not $found) {
  Write-Error "ONNX artifact not found after export. Look in $yoloDir for .onnx files."
  exit 3
}

$dest = Join-Path $modelsDir ([System.IO.Path]::GetFileName($found))
Copy-Item -Path $found -Destination $dest -Force
Write-Host "Copied ONNX to: $dest"
Write-Host "Done. You can now start the server and it should pick up the ONNX model from server/models/"

exit 0