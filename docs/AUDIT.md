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

| Model | Implementation | Evaluation |
|---|---|---|
| Fleet / per-turbine empirical power curve | `scripts/build_frontend_data.py` | Time-aware holdout (train < 2017-10-01): R² 0.947, RMSE 123 kW, 90 % interval coverage 94.0 % |
| Physics reference (actuator disc) | same | R² 0.911 on the same test set |
| Anomaly detector (power-curve residual exceedance) | same | 278 sustained events, 2.18 % flagged records |
| Forecast baselines (persistence, climatology) | same | horizons 1–24 h |
| Gaussian wake model (Bastankhah & Porté-Agel 2014) | `frontend/src/physics/wake.ts` | unit tests; FLORIS 4.6.6 Gauss model agrees within +0.44 % farm power (max 7 kW/turbine) on the default onshore layout |
| Layout optimizer (pattern search, wind-rose AEP) | `frontend/src/physics/optimizer.ts` (Web Worker) | tests: never decreases AEP, respects constraints and locked turbines |
| Hydrogen dispatch (staging, storage, energy balance) | `frontend/src/physics/hydrogen.ts` | tests: energy balance closes; optimal ≥ sequential staging |

**Not implemented** (shown as unavailable in the UI, never with invented metrics): CNN-PINN, Physics-GNN, learned forecaster, Isolation Forest, server-side optimizer and hydrogen dispatch, LLM copilot provider, turbine operating-setting (yaw/derate) control models.

## 5. Frontend file inventory

```
frontend/src/
  app/            router, navigation
  components/
    shell/        AppShell, Sidebar, Topbar (breadcrumbs, backend pill, notifications, profile), CommandSearch, Logo
    ui/           primitives, Kpi, Provenance, controls, states, Dialog, Tooltip
    charts/       chartTheme (validated palette), WindRose, TimeRange
    twin/         TwinScene, TurbineField (instanced), WakeLayers (wake slice, particles, arrow), Environment, TurbineDetail
    planner/      LayoutCanvas (SVG editor), OptimizePanel, ComparisonPanel, FlorisCheck
    hydro/        HydroScene
    hydrogen/     EnergyFlow
    copilot/      CopilotChat, FloatingCopilot
  pages/          13 sections + 404 + route error
  physics/        turbines, wake, aep, constraints, optimizer, hydro, hydrogen
  lib/            engineering hooks, scenario metrics, hydrogen scenarios, copilot engine, series, format, provenance
  services/       dataService (extracts), api (backend client)
  store/          siteStore (onshore/offshore, undo/redo), appStores (UI, scenarios, copilot)
  workers/        optimizer.worker.ts
  test/           physics, stores, UI/copilot tests
```
