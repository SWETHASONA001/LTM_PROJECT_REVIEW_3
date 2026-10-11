# AeroHydro-PINN

**Multimodal physics-AI for wake-aware hydrogen optimization** — an engineering platform that combines real wind SCADA, tidal-current and electrolyzer data with a wake model, a turbine-placement optimizer, hydrogen dispatch and an engineering copilot. Every figure is labeled by provenance: observed, processed, predicted, physics-derived, simulated or optimized.

```
data/raw/        real datasets (read-only, not committed)
scripts/         build_frontend_data.py → provenance-tagged JSON extracts
frontend/        React + TypeScript + Vite app (R3F digital twins, planner, copilot)
backend/         FastAPI: datasets, FLORIS simulation, layout validation, scenarios
docs/            AUDIT.md (repository & data audit), DEPLOYMENT.md
reports/, audit_*.py, inspect_*.py   original data-audit scripts and reports
```

## Quick start (Windows, PowerShell or Git Bash)

```bash
# 1. Build data extracts from data/raw (≈15 s; needs pandas, numpy, xarray, netCDF4)
py -3.11 scripts/build_frontend_data.py

# 2. Frontend
cd frontend
npm install
npm run dev            # http://localhost:5173  (standalone mode, no backend needed)

# 3. Optional backend (FLORIS + API)
cd ../backend
py -3.11 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --port 8000
# then run the frontend with:  VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

## What runs where

| Capability | Standalone frontend | With backend |
|---|---|---|
| Dataset views (wind, hydro, electrolyzer, models, anomalies) | static extracts in `frontend/public/data` | also via `/api/*` |
| Wake model, AEP, layout optimizer, hydrogen dispatch | in-browser (Web Worker for optimizer) | same |
| FLORIS cross-check | unavailable (stated in UI) | `/api/floris/simulate` (FLORIS 4.x) |
| Copilot | local tool mode (deterministic tools, not an LLM) | LLM endpoint returns 503 until a provider is integrated |

## Tests

```bash
cd frontend && npm test                     # 22 unit tests (physics, stores, UI, copilot tools)
cd frontend && npm run build                # typecheck + production build
cd backend  && .venv/Scripts/python -m pytest -q   # 7 API tests incl. a real FLORIS run
# Browser QA (needs a running dev server and local Chrome/Edge):
cd frontend && node scripts/qa-screens.mjs http://localhost:5173 qa-output
cd frontend && node scripts/qa-interactions.mjs http://localhost:5173 qa-output
```

See [docs/AUDIT.md](docs/AUDIT.md) for what exists, what is modeled and what is still missing, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Vercel/Netlify + backend hosting.
