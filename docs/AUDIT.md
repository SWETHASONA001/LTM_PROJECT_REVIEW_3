# Repository and data audit

Audit date: 2026-10-11. Baseline commit on `main`: “Baseline: audit scripts, reports and dataset READMEs before platform build”. All platform work is on branch `feature/platform-frontend`.

## 1. What existed before this work

| Item | Found |
|---|---|
| Frontend / UI, components, design system, screenshots, image assets | **None.** No previous AeroHydro interface, digital twin or Git history existed to restore. |
| Backend / API routes | None |
| Model code (CNN-PINN, Physics-GNN, forecaster, Isolation Forest) | None; no trained weights or artifacts |
| FLORIS integration | None (FLORIS was not installed) |
| Data | 4 CSVs, 14 NetCDF files, 2 READMEs under `data/raw/` |
| Scripts / reports | `audit_*.py`, `inspect_*.py`, `reports/*.txt` |

Nothing pre-existing was deleted or modified. The original scripts, reports and raw data are untouched; the platform is new code in `frontend/`, `backend/`, `scripts/` and `docs/`.

## 2. Dataset findings that shape the UI

**Wind SCADA** — `data/raw/wind/la-haute-borne-data-2017-2020.csv` (`;`-separated, 217,588 rows, 138 columns)
- Four turbines: R80711, R80721, R80736, R80790; 10-minute records.
- Despite the file name, records span **2016-12-31 23:00 UTC → 2018-01-12**, not 2017–2020.
- 912 rows in duplicate turbine/timestamp groups (first kept). 10 columns completely empty (`Pas_*`, `Wa_c_min/max/std`, `Na_c_min/max/std`).
- No turbine coordinates, alarm/status codes or datasheet. Turbine positions in the twin are **schematic**; rotor diameter 82 m and hub height 80 m come from the public Senvion MM82 specification and are labeled “assumption — verify”. Rated power (2,045 kW) is derived from observed `P_avg`.
- Channel meanings follow the ENGIE La Haute Borne data dictionary, which is not in the repository.

**Hydro** — `data/raw/hydro/*.nc` (14 sites)
- Processed ADCP current depth profiles (Jang et al.), 2005–2016, one site per file: `principal_profile` (m/s, + flood / − ebb), depth, bin heights, power-law fit, profile-shape label.
- **No turbine or generator power.** All hydrokinetic power is modeled with ½ρAv³·Cp·η. The README’s 0.75 m/s “minimum operation speed” is used as cut-in.

**Electrolyzer** — `data/raw/electrolyzer/*.csv`, `data/raw/hydro-electrolyzer/*.csv`
- Measured PEM test-stand response (stack power `H2E_n_PSU_A_Power`, H₂ flow `IVAL_f_FM011_Flow`) to wind power profiles (IEA 3.4 MW at 5/7/9 m/s; GE 1.5 MW) and to a **simulated** 500 kW tidal profile.
- Overall specific energy 53.2 kWh/kg; stack range ≈98–1,261 kW; more efficient at part load.
- `hydro-electrolyzer/README_648.txt` is a byte-identical copy of the ADCP README and does not document the tidal experiments.

## 3. Provenance model

| Label | Used for |
|---|---|
| Observed | SCADA values, ADCP velocities, electrolyzer measurements |
| Processed | hourly means, binned power curves, wind rose, monthly energy, stack curve |
| Predicted | empirical power-curve models, anomaly detector, forecast baselines |
| Physics-derived | Gaussian wake model, FLORIS, ½ρAv³ power density |
| Simulated | proposed turbines, offshore farm, hydro turbines, hydrogen plant, tidal input profile |
| Optimized | layout-optimizer candidates |
| Assumption | user/literature values (spacing, Cp, η, D, TI, Weibull resource) |

## 4. Implemented models and their evidence

All learned models share one time-aware split: train before 2017-09-01, validation Sep 2017 (early stopping, calibration), test from 2017-10-01. Nothing is tuned on the test period.

| Model | Code / artifact | Held-out evidence |
|---|---|---|
| Empirical power curves (fleet, per turbine) | `scripts/build_frontend_data.py` | R² 0.947, RMSE 123 kW |
| Physics reference (actuator disc, no learning) | same | R² 0.911 |
| **CNN-PINN** — 1-D CNN over the last hour; loss = data + Betz/rated bound (ρ from temperature) + monotonic power below rated (autograd) + cut-in, on data and 0–25 m/s collocation windows | `ml/cnn_pinn.py`, `ml/train_cnn_pinn.py`, `models/cnn_pinn.pt` | R² 0.949, RMSE 121 kW; physics sweep: 9 bound violations vs 485 for the identical CNN without physics loss; conformal 90 % interval covers 85 % (seasonal shift) |
| **Physics-GNN** — 4 turbine nodes, edge weights learned from wind direction (no coordinates available), per-node physics residuals | `ml/train_physics_gnn.py`, `models/physics_gnn.pt` | R² 0.945; **no gain** over the ablation without message passing — reported as a finding |
| **Forecaster** — HistGradientBoosting per horizon, conformalized quantile intervals | `ml/train_forecaster.py`, `models/forecaster.joblib` | RMSE vs persistence: +1.8 % (1 h), −1.3 % (3 h), −5.5 % (6 h), −10.2 % (12 h), −6.8 % (24 h); coverage 78–89 % |
| **Isolation Forest** — 7 SCADA-derived features, threshold at training 99th percentile | `ml/train_isolation_forest.py`, `models/isolation_forest.joblib` | 222 sustained events; driver feature reported per event; overlap with the residual detector shown in the UI |
| Anomaly detector (power-curve residual) | `scripts/build_frontend_data.py` | 278 events |
| Gaussian wake model | `frontend/src/physics/wake.ts` | FLORIS 4.6.6 agrees within +0.44 % farm power, max 7 kW/turbine |
| Layout optimizer — in-browser (Gaussian) and server (FLORIS) | `physics/optimizer.ts`, `backend/app/optimizer_service.py` | never decreases AEP, respects constraints and locked turbines; FLORIS run: +6.5 % AEP in 80 evaluations |
| Installation recommendations — greedy sequential siting on wind-rose AEP, net of wake losses imposed on existing turbines | `physics/siting.ts` (Web Worker) | unit test: feasible, spacing-respecting, positive net gain; default onshore run: +20.6 % AEP for 3 sites |
| Hydrogen dispatch — browser and Python | `physics/hydrogen.ts`, `backend/app/hydrogen_service.py` | energy balance closes; the two implementations agree to 0.000 kg |
| Copilot agent (Claude, tool use over project APIs) | `backend/app/copilot_service.py` | tool loop tested with a mocked client; **not exercised live** because no Anthropic credentials exist on this machine |

**Still not available:** turbine operating-setting models (yaw/derate control), NWP inputs for day-ahead forecasting, turbine coordinates and alarm logs (data not in the repository).

## 5. Frontend file inventory

```
frontend/src/
  app/            router, navigation
  components/
    shell/        AppShell, Sidebar, Topbar (breadcrumbs, backend pill, notifications, profile), CommandSearch, Logo
    ui/           primitives, Kpi, Provenance, controls, states, Dialog, Tooltip
    charts/       chartTheme (validated palette), WindRose, TimeRange
    twin/         TwinScene, TurbineField (instanced), WakeLayers (wake slice, particles, arrow), Environment, TurbineDetail
    planner/      LayoutCanvas (SVG editor), OptimizePanel (Gaussian or FLORIS engine), ComparisonPanel, FlorisCheck
    models/       MlSections (CNN-PINN, Physics-GNN)
    hydro/        HydroScene
    hydrogen/     EnergyFlow
    copilot/      CopilotChat, FloatingCopilot
  pages/          13 sections + 404 + route error
  physics/        turbines, wake, aep, constraints, optimizer, hydro, hydrogen
  lib/            engineering hooks, scenario metrics, hydrogen scenarios, copilot engine + backend context, series, format, provenance
  services/       dataService (extracts), api (backend client)
  store/          siteStore (onshore/offshore, undo/redo), appStores (UI, scenarios, copilot)
  workers/        optimizer.worker.ts
  test/           physics, stores, UI/copilot tests
```

## 6. Backend API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | capabilities: FLORIS, LLM, CNN-PINN, forecaster, datasets |
| `GET /api/datasets`, `/api/wind/summary`, `/api/wind/hourly`, `/api/hydro/sites`, `/api/models`, `/api/ml` | data extracts and model reports |
| `POST /api/floris/simulate` | FLORIS wake simulation for a layout |
| `POST /api/optimize` | FLORIS-based layout optimisation |
| `POST /api/layout/validate` | spacing / boundary validation |
| `POST /api/models/cnn-pinn/predict`, `GET /api/models/cnn-pinn/curve` | CNN-PINN inference with conformal interval and physics bound |
| `POST /api/forecast` | 1–24 h farm-power forecast from a historical issue time |
| `POST /api/hydrogen/allocate` | electrolyzer + battery dispatch |
| `GET/POST/DELETE /api/scenarios` | scenario persistence |
| `POST /api/auth/login`, `GET /api/auth/me` | sign-in (PBKDF2 users in backend/storage, HMAC-signed 12 h tokens) |
| `POST /api/copilot/chat` | Claude agent with 12 project tools (503 until credentials are configured) |
