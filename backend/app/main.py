"""AeroHydro-PINN FastAPI backend.

Serves dataset extracts, FLORIS wake simulations (when installed), layout
validation and scenario persistence. Endpoints for capabilities that are not
implemented yet return explicit 501/503 responses — never placeholder data.

Run:  uvicorn app.main:app --reload --port 8000   (from the backend/ folder)
"""

from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, copilot_service, floris_service, hydrogen_service, ml_service, optimizer_service

app = FastAPI(title="AeroHydro-PINN API", version=config.VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


@lru_cache(maxsize=16)
def _extract(name: str) -> Any:
    path = config.DATA_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(503, f"Data extract '{name}' not found. Run scripts/build_frontend_data.py.")
    return json.loads(path.read_text(encoding="utf-8"))


# --------------------------------------------------------------- health ----


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": config.VERSION,
        "capabilities": {
            "floris": floris_service.available(),
            "floris_version": floris_service.FLORIS_VERSION,
            "llm": copilot_service.enabled(),
            "llm_model": copilot_service.MODEL if copilot_service.enabled() else None,
            "datasets": (config.DATA_DIR / "manifest.json").exists(),
            "cnn_pinn": ml_service.cnn_status()["available"],
            "forecaster": (ml_service.MODEL_DIR / "forecaster.joblib").exists(),
        },
    }


# ------------------------------------------------------------- datasets ----


@app.get("/api/datasets")
def datasets() -> Any:
    return _extract("manifest")


@app.get("/api/wind/summary")
def wind_summary() -> Any:
    return _extract("wind_summary")


@app.get("/api/wind/hourly")
def wind_hourly(
    turbine: str = Query(..., description="SCADA turbine id, e.g. R80711"),
    start: int = Query(0, ge=0, description="Hour index from series start"),
    hours: int = Query(168, ge=1, le=24 * 400),
    fields: str = Query("P,Ws,Wa", description="Comma-separated fields: P,Ws,Wa,Rs,Ba,Ot,Ya,n"),
) -> dict[str, Any]:
    h = _extract("wind_hourly")
    if turbine not in h["turbines"]:
        raise HTTPException(404, f"Unknown turbine '{turbine}'. Available: {sorted(h['turbines'])}")
    series = h["turbines"][turbine]
    wanted = [f for f in fields.split(",") if f]
    bad = [f for f in wanted if f not in series]
    if bad:
        raise HTTPException(400, f"Unknown field(s): {bad}")
    end = min(start + hours, h["length"])
    return {
        "provenance": h["provenance"],
        "turbine": turbine,
        "start": h["start"],
        "startIndex": start,
        "values": {f: series[f][start:end] for f in wanted},
        "units": {f: h["fields"].get(f) for f in wanted},
    }


@app.get("/api/hydro/sites")
def hydro_sites() -> Any:
    return _extract("hydro_sites")


@app.get("/api/models")
def models() -> Any:
    return _extract("models")


# --------------------------------------------------------------- FLORIS ----


class TurbineCurve(BaseModel):
    rotor_diameter: float = Field(gt=0)
    hub_height: float = Field(gt=0)
    ws: list[float]
    power_kw: list[float]
    ct: list[float]


class FlorisRequest(BaseModel):
    site: Literal["onshore", "offshore"]
    x: list[float] = Field(min_length=1, max_length=500)
    y: list[float] = Field(min_length=1, max_length=500)
    wind_direction: float = Field(ge=0, lt=360)
    wind_speed: float = Field(ge=0, le=40)
    turbulence_intensity: float = Field(gt=0, le=0.5)
    turbine: TurbineCurve


@app.post("/api/floris/simulate")
def floris_simulate(req: FlorisRequest) -> dict[str, Any]:
    if len(req.x) != len(req.y):
        raise HTTPException(422, "x and y must have the same length")
    if not floris_service.available():
        raise HTTPException(503, "FLORIS is not installed on this backend. Install with: pip install 'floris>=4.1,<5'")
    try:
        return floris_service.simulate(req.model_dump())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"FLORIS simulation failed: {exc}") from exc


# --------------------------------------------------- layout validation ----


class LayoutTurbine(BaseModel):
    id: str
    x: float
    y: float


class ValidateRequest(BaseModel):
    turbines: list[LayoutTurbine] = Field(max_length=1000)
    rotor_diameter: float = Field(gt=0)
    min_spacing_d: float = Field(gt=0)
    boundary_width: float = Field(gt=0)
    boundary_height: float = Field(gt=0)


@app.post("/api/layout/validate")
def layout_validate(req: ValidateRequest) -> dict[str, Any]:
    min_m = req.min_spacing_d * req.rotor_diameter
    hw, hh = req.boundary_width / 2, req.boundary_height / 2
    violations: list[dict[str, Any]] = []
    t = req.turbines
    for i, a in enumerate(t):
        out = max(abs(a.x) - hw, abs(a.y) - hh, 0.0)
        if out > 0.5:
            violations.append({"kind": "boundary", "ids": [a.id], "amount_m": round(out, 1)})
        for b in t[i + 1 :]:
            d = math.hypot(a.x - b.x, a.y - b.y)
            if d < min_m - 0.5:
                violations.append({"kind": "spacing", "ids": [a.id, b.id], "distance_m": round(d, 1), "required_m": round(min_m, 1)})
    return {"valid": not violations, "violations": violations, "constraint_source": "user-configured planning constraint"}


# ---------------------------------------------------------- scenarios ----


class ScenarioIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    site: Literal["onshore", "offshore"]
    turbines: list[dict[str, Any]]
    conditions: dict[str, Any] = {}
    metrics: dict[str, Any] = {}
    origin: str = "manual"


def _scenario_file():
    config.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    return config.STORAGE_DIR / "scenarios.json"


def _load_scenarios() -> list[dict[str, Any]]:
    f = _scenario_file()
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []


def _save_scenarios(items: list[dict[str, Any]]) -> None:
    _scenario_file().write_text(json.dumps(items, indent=2), encoding="utf-8")


@app.get("/api/scenarios")
def list_scenarios() -> list[dict[str, Any]]:
    return _load_scenarios()


@app.post("/api/scenarios", status_code=201)
def create_scenario(s: ScenarioIn) -> dict[str, Any]:
    items = _load_scenarios()
    item = {**s.model_dump(), "id": uuid.uuid4().hex[:12], "createdAt": datetime.now(timezone.utc).isoformat()}
    items.insert(0, item)
    _save_scenarios(items)
    return item


@app.delete("/api/scenarios/{scenario_id}", status_code=204)
def delete_scenario(scenario_id: str) -> None:
    items = _load_scenarios()
    kept = [s for s in items if s["id"] != scenario_id]
    if len(kept) == len(items):
        raise HTTPException(404, "Scenario not found")
    _save_scenarios(kept)


# ------------------------------------------------------- trained models ----


class PredictRequest(BaseModel):
    wind_speed: float = Field(ge=0, le=40)
    wind_direction: float = Field(210.0, ge=0, lt=360)
    temperature: float = Field(10.0, ge=-40, le=50)
    wind_speed_std: float | None = Field(None, ge=0, le=10)


@app.post("/api/models/cnn-pinn/predict")
def cnn_pinn_predict(req: PredictRequest) -> dict[str, Any]:
    try:
        return ml_service.cnn_predict(req.wind_speed, req.wind_direction, req.wind_speed_std, req.temperature)
    except ml_service.Unavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/api/models/cnn-pinn/curve")
def cnn_pinn_curve(wind_direction: float = Query(210.0, ge=0, lt=360), temperature: float = Query(10.0, ge=-40, le=50)) -> dict[str, Any]:
    try:
        return ml_service.cnn_curve(wind_direction, temperature)
    except ml_service.Unavailable as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/api/ml")
def ml_report() -> Any:
    return _extract("ml_models")


class ForecastRequest(BaseModel):
    issue_time: str = Field(description="ISO timestamp within the SCADA record")


@app.post("/api/forecast")
def forecast(req: ForecastRequest) -> dict[str, Any]:
    try:
        return ml_service.forecast(req.issue_time)
    except ml_service.Unavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


# ----------------------------------------------------- server optimizer ----


class Cases(BaseModel):
    dirs: list[float] = Field(min_length=1, max_length=2000)
    speeds: list[float] = Field(min_length=1, max_length=2000)
    probs: list[float] = Field(min_length=1, max_length=2000)


class OptimizeRequest(BaseModel):
    x: list[float] = Field(min_length=1, max_length=200)
    y: list[float] = Field(min_length=1, max_length=200)
    movable: list[bool]
    turbine: TurbineCurve
    cases: Cases
    turbulence_intensity: float = Field(gt=0, le=0.5)
    min_spacing_d: float = Field(gt=0)
    boundary_width: float = Field(gt=0)
    boundary_height: float = Field(gt=0)
    max_evaluations: int = Field(200, ge=10, le=2000)
    initial_step_d: float = Field(2.0, gt=0, le=10)
    min_step_d: float = Field(0.1, gt=0, le=5)
    seed: int = 7


@app.post("/api/optimize")
def optimize(req: OptimizeRequest) -> dict[str, Any]:
    if not (len(req.x) == len(req.y) == len(req.movable)):
        raise HTTPException(422, "x, y and movable must have the same length")
    if not (len(req.cases.dirs) == len(req.cases.speeds) == len(req.cases.probs)):
        raise HTTPException(422, "cases arrays must have the same length")
    if not floris_service.available():
        raise HTTPException(503, "FLORIS is not installed on this backend.")
    try:
        return optimizer_service.optimise(req.model_dump())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Optimisation failed: {exc}") from exc


# ----------------------------------------------------- hydrogen dispatch ----


class StackCurve(BaseModel):
    kw: list[float] = Field(min_length=2)
    kg_per_h: list[float] = Field(min_length=2)


class Plant(BaseModel):
    modules: int = Field(ge=1, le=200)
    staging: Literal["sequential", "optimal"] = "optimal"
    storage_kwh: float = Field(0, ge=0)
    storage_kw: float = Field(0, ge=0)
    round_trip_eff: float = Field(0.88, gt=0, le=1)


class HydrogenRequest(BaseModel):
    available_kw: list[float | None] = Field(min_length=1, max_length=100_000)
    dt_h: float = Field(1.0, gt=0)
    stack_curve: StackCurve
    plant: Plant


@app.post("/api/hydrogen/allocate")
def hydrogen_allocate(req: HydrogenRequest) -> dict[str, Any]:
    return hydrogen_service.dispatch(req.model_dump())


# ---------------------------------------------------------------- copilot ----


class CopilotRequest(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=4000)
    context: dict[str, Any] = {}


@app.post("/api/copilot/chat")
def copilot_chat(req: CopilotRequest) -> dict[str, Any]:
    if not copilot_service.enabled():
        raise HTTPException(503, "LLM provider not configured. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN, or AEROHYDRO_LLM_PROVIDER=anthropic with an `ant auth login` profile) on the backend.")
    import anthropic  # noqa: PLC0415

    try:
        return copilot_service.chat(req.conversation_id, req.message, req.context)
    except anthropic.AuthenticationError as exc:
        raise HTTPException(503, "Anthropic credentials were rejected; check the backend API key.") from exc
    except anthropic.RateLimitError as exc:
        raise HTTPException(429, "Rate limited by the LLM provider; retry shortly.") from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(502, "Could not reach the LLM provider.") from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(502, f"LLM provider error ({exc.status_code}).") from exc
