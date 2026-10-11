# Starts the AeroHydro-PINN backend (http://127.0.0.1:8000) and frontend (http://localhost:5173).
# Usage (from the repository root, in PowerShell):  .\start-local.ps1
# Optional: set $env:ANTHROPIC_API_KEY before running to enable the Claude copilot agent.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    Write-Host 'Creating backend virtual environment (first run)...'
    py -3.11 -m venv (Join-Path $root 'backend\.venv')
    & $py -m pip install --upgrade pip
    & $py -m pip install torch --index-url https://download.pytorch.org/whl/cpu
    & $py -m pip install -r (Join-Path $root 'backend\requirements.txt')
}

# Rebuild missing artifacts (raw data must be present in data/raw).
if (-not (Test-Path (Join-Path $root 'models\forecaster.joblib'))) { & $py (Join-Path $root 'ml\train_forecaster.py') }
if (-not (Test-Path (Join-Path $root 'models\isolation_forest.joblib'))) { & $py (Join-Path $root 'ml\train_isolation_forest.py') }

$envFile = Join-Path $root 'frontend\.env.local'
if (-not (Test-Path $envFile)) { Set-Content -Path $envFile -Value 'VITE_API_BASE_URL=http://localhost:8000' -Encoding ascii }
if (-not (Test-Path (Join-Path $root 'frontend\node_modules'))) { Push-Location (Join-Path $root 'frontend'); npm install; Pop-Location }

Start-Process -FilePath $py -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000' -WorkingDirectory (Join-Path $root 'backend')
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev' -WorkingDirectory (Join-Path $root 'frontend')
Write-Host 'Backend:  http://127.0.0.1:8000/docs'
Write-Host 'Frontend: http://localhost:5173'
