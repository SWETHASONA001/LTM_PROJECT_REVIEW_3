"""AeroHydro Engineering Copilot — Claude agent with project tools.

A manual tool-use loop over Claude (claude-opus-5-5). Every tool reads real
project data or runs a real model; the model is instructed to separate facts,
assumptions and recommendations and never to invent measurements. Operator
instructions are drafted through a dedicated tool and are never executed.

Enabled when Anthropic credentials are available to the backend
(ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, or AEROHYDRO_LLM_PROVIDER=anthropic
when using an `ant auth login` profile). Keys never reach the browser.
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Callable

import numpy as np

from . import config, floris_service, hydrogen_service, ml_service

MODEL = os.getenv("AEROHYDRO_LLM_MODEL", "claude-opus-5-5")
MAX_TOOL_ROUNDS = 8

SYSTEM_PROMPT = """You are the AeroHydro Engineering Copilot, a decision-support assistant for wind-farm, hydrokinetic and green-hydrogen engineers.

Ground every data-specific statement in a tool result from this conversation. The project data are historical: La Haute Borne SCADA for turbines R80711, R80721, R80736 and R80790 (1 Jan 2017 – 12 Jan 2018), ADCP tidal-current profiles at 14 sites, and electrolyzer test-stand experiments. There is no live telemetry. Proposed turbines and the offshore farm have no measurements; only modeled values exist for them. Turbine coordinates are schematic.

Structure answers with three short sections when they apply — "Facts" (from tools, with units), "Assumptions" and "Recommendations". Label each number's origin (observed, processed, predicted, physics-derived, simulated, optimized). If a requested measurement is not available, say so plainly instead of estimating it.

When the user asks for an operator instruction or a setting change, call draft_operator_instruction. You cannot control turbines: every instruction is a draft that requires authorized operator approval and a validated control-system integration."""

_lock = threading.Lock()
_conversations: dict[str, list[dict[str, Any]]] = {}


def enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or config.LLM_PROVIDER == "anthropic")


def _extract(name: str) -> Any:
    return json.loads((config.DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))


# ------------------------------------------------------------------ tools ----

def t_layout_context(ctx: dict[str, Any], **_: Any) -> dict[str, Any]:
    if not ctx.get("layout"):
        return {"error": "The frontend sent no layout context."}
    return {k: ctx.get(k) for k in ["site", "selected_turbine", "wind_direction", "wind_speed", "turbulence_intensity", "min_spacing_d", "boundary", "candidate", "layout"]}


def t_wake_simulation(ctx: dict[str, Any], wind_direction: float | None = None, wind_speed: float | None = None, **_: Any) -> dict[str, Any]:
    layout = ctx.get("layout") or []
    turbine = ctx.get("turbine_curve")
    if not layout or not turbine:
        return {"error": "No layout or turbine curve in context."}
    if not floris_service.available():
        return {"error": "FLORIS is not installed on the backend."}
    wd = float(wind_direction if wind_direction is not None else ctx.get("wind_direction", 270))
    ws = float(wind_speed if wind_speed is not None else ctx.get("wind_speed", 8))
    r = floris_service.simulate({
        "x": [t["x"] for t in layout], "y": [t["y"] for t in layout], "wind_direction": wd, "wind_speed": ws,
        "turbulence_intensity": float(ctx.get("turbulence_intensity", 0.1)), "turbine": turbine,
    })
    free = float(np.interp(ws, turbine["ws"], turbine["power_kw"]))
    rows = sorted(({"turbine": t["label"], "status": t["status"], "power_kw": round(p, 1), "effective_ws": round(v, 2)} for t, p, v in zip(layout, r["turbine_power_kw"], r["turbine_ws"])), key=lambda d: d["power_kw"])
    return {"engine": r["engine"], "wind_direction": wd, "wind_speed": ws, "farm_power_kw": round(r["farm_power_kw"], 1), "unwaked_farm_kw": round(free * len(layout), 1), "wake_loss": round(1 - r["farm_power_kw"] / (free * len(layout)), 4) if free > 0 else None, "turbines_lowest_power_first": rows, "provenance": "physics-derived"}


def t_turbine_summary(ctx: dict[str, Any], turbine: str, **_: Any) -> dict[str, Any]:
    s = _extract("wind_summary")
    stat = next((x for x in s["turbineStats"] if x["id"] == turbine), None)
    if not stat:
        return {"error": f"No measurements for {turbine}. Measured turbines: {s['turbines']}."}
    return {**stat, "rated_power_kw_observed": s["ratedPowerKwObserved"], "provenance": "processed (SCADA)"}


def t_anomalies(ctx: dict[str, Any], turbine: str | None = None, month: int | None = None, **_: Any) -> dict[str, Any]:
    res = _extract("anomalies")["events"]
    ml = _extract("ml_models").get("isolationForest", {}).get("events", []) if (config.DATA_DIR / "ml_models.json").exists() else []

    def keep(e):
        ok = turbine is None or e["turbine"] == turbine
        if month:
            ok = ok and int(e["start"][5:7]) == int(month)
        return ok

    r = [e for e in res if keep(e)]
    i = [e for e in ml if keep(e)]
    return {
        "residual_detector": {"count": len(r), "deficit_mwh": round(sum(e["deficitMWh"] for e in r), 2), "largest": sorted(r, key=lambda e: -e["deficitMWh"])[:5]},
        "isolation_forest": {"count": len(i), "longest": i[:5]},
        "note": "Historical events. Causes are inferred; the dataset has no alarm/status codes.",
    }


def t_scada_hour(ctx: dict[str, Any], turbine: str, timestamp: str, **_: Any) -> dict[str, Any]:
    import pandas as pd  # noqa: PLC0415

    h = _extract("wind_hourly")
    if turbine not in h["turbines"]:
        return {"error": f"No measurements for {turbine}."}
    t = pd.Timestamp(timestamp)
    t = t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")
    idx = int(round((t - pd.Timestamp(h["start"])).total_seconds() / 3600))
    if not 0 <= idx < h["length"]:
        return {"error": f"Outside the record ({h['start']} + {h['length']} h)."}
    s = h["turbines"][turbine]
    return {"turbine": turbine, "hour_utc": (pd.Timestamp(h["start"]) + pd.Timedelta(hours=idx)).isoformat(), **{k: s[k][idx] for k in ["P", "Ws", "Wa", "Rs", "Ba", "Ot", "Ya", "n"]}, "units": h["fields"], "provenance": "observed (hourly mean)"}


def t_predict(ctx: dict[str, Any], wind_speed: float, wind_direction: float = 210.0, temperature: float = 10.0, wind_speed_std: float | None = None, **_: Any) -> dict[str, Any]:
    try:
        return ml_service.cnn_predict(wind_speed, wind_direction, wind_speed_std, temperature)
    except ml_service.Unavailable as exc:
        return {"error": str(exc)}


def t_forecast(ctx: dict[str, Any], issue_time: str, **_: Any) -> dict[str, Any]:
    try:
        return ml_service.forecast(issue_time)
    except (ml_service.Unavailable, ValueError) as exc:
        return {"error": str(exc)}


def t_model_metrics(ctx: dict[str, Any], **_: Any) -> dict[str, Any]:
    base = _extract("models")
    ml = _extract("ml_models") if (config.DATA_DIR / "ml_models.json").exists() else {}
    out = {"split": base["split"], "baselines": [{"name": m["name"], "metrics": m["metrics"], "interval": m.get("interval")} for m in base["models"]]}
    if "cnnPinn" in ml:
        c = ml["cnnPinn"]
        out["cnn_pinn"] = {"metrics": c["pinn"]["metrics"], "interval": c["pinn"]["interval"], "physics_violations": c["pinn"]["physicsAudit"], "ablation_no_physics": {"metrics": c["ablation"]["metrics"], "physics_violations": c["ablation"]["physicsAudit"]}}
    if "physicsGnn" in ml:
        out["physics_gnn"] = {"metrics": ml["physicsGnn"]["gnn"]["metrics"], "without_message_passing": ml["physicsGnn"]["ablation"]["metrics"]}
    if "forecaster" in ml:
        out["forecaster"] = ml["forecaster"]["horizons"]
    return out


def t_data_quality(ctx: dict[str, Any], **_: Any) -> dict[str, Any]:
    s = _extract("wind_summary")
    return {"time_range": s["timeRange"], "channels": s["channels"], "empty_columns": s["emptyColumns"], "duplicate_key_rows": s["duplicateKeyRows"], "not_in_repository": ["turbine coordinates", "alarm/status logs", "offshore measurements", "hydrokinetic generator power", "met-mast data"]}


def t_hydro_site(ctx: dict[str, Any], code: str | None = None, **_: Any) -> dict[str, Any]:
    h = _extract("hydro_sites")
    if code:
        s = next((x for x in h["sites"] if x["code"].upper() == code.upper()), None)
        if not s:
            return {"error": f"Unknown site {code}."}
        return {k: s[k] for k in ["code", "name", "lat", "lon", "start", "end", "records", "meanDepthM", "speed", "aboveCutInShare", "meanPowerDensityWm2"]} | {"provenance": "observed velocities; power density physics-derived"}
    return {"sites": [{"code": s["code"], "name": s["name"], "mean_speed": s["speed"]["mean"], "power_density_wm2": s["meanPowerDensityWm2"]} for s in h["sites"]], "equations": "P_available = 0.5·ρ·A·v³; P_electrical = min(P_rated, P_available·Cp·η); 0 below 0.75 m/s"}


def t_hydrogen(ctx: dict[str, Any], modules: int = 12, staging: str = "optimal", storage_kwh: float = 0.0, **_: Any) -> dict[str, Any]:
    h = _extract("wind_hourly")
    e = _extract("electrolyzer")
    series = []
    for i in range(h["length"]):
        vals = [h["turbines"][t]["P"][i] for t in h["turbines"]]
        series.append(sum(max(0.0, v) for v in vals) if all(v is not None for v in vals) else 0.0)
    r = hydrogen_service.dispatch({"available_kw": series, "stack_curve": {"kw": e["stackCurve"]["stackKw"], "kg_per_h": e["stackCurve"]["flowKgH"]}, "plant": {"modules": modules, "staging": staging, "storage_kwh": storage_kwh, "storage_kw": 2000, "round_trip_eff": 0.88}})
    return {**r, "input": "observed 4-turbine SCADA power (hours with any turbine missing = 0)", "electrolyzer_curve": "measured test-stand stack curve; scale-out to N stacks is assumed"}


def t_draft_instruction(ctx: dict[str, Any], **kw: Any) -> dict[str, Any]:
    return {"status": "DRAFT — NOT EXECUTED", "instruction": kw, "requires": "Authorized operator approval and a validated control-system integration."}


TOOLS: dict[str, tuple[Callable[..., dict[str, Any]], dict[str, Any]]] = {
    "get_layout_context": (t_layout_context, {"description": "Current planner/twin context from the user's screen: site, selected turbine, conditions, spacing constraint, layout and optimized candidate summary.", "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}}),
    "run_wake_simulation": (t_wake_simulation, {"description": "Run a FLORIS wake simulation for the current layout. Returns per-turbine modeled power (lowest first), farm power and wake loss. Physics-derived, not measured.", "input_schema": {"type": "object", "properties": {"wind_direction": {"type": "number", "description": "Meteorological degrees (from). Defaults to the current condition."}, "wind_speed": {"type": "number", "description": "Hub-height m/s. Defaults to the current condition."}}, "additionalProperties": False}}),
    "get_turbine_summary": (t_turbine_summary, {"description": "Observed SCADA statistics for one real turbine (energy, capacity factor, missing data).", "input_schema": {"type": "object", "properties": {"turbine": {"type": "string", "enum": ["R80711", "R80721", "R80736", "R80790"]}}, "required": ["turbine"], "additionalProperties": False}}),
    "get_anomaly_events": (t_anomalies, {"description": "Historical under-performance events from the power-curve residual detector and the Isolation Forest, optionally filtered by turbine and month (1–12).", "input_schema": {"type": "object", "properties": {"turbine": {"type": "string"}, "month": {"type": "integer", "minimum": 1, "maximum": 12}}, "additionalProperties": False}}),
    "get_scada_hour": (t_scada_hour, {"description": "Observed hourly-mean SCADA values (P kW, Ws m/s, Wa deg, Rs rpm, Ba deg pitch, Ot degC, Ya deg) for a real turbine at a UTC timestamp.", "input_schema": {"type": "object", "properties": {"turbine": {"type": "string"}, "timestamp": {"type": "string", "description": "ISO timestamp, UTC"}}, "required": ["turbine", "timestamp"], "additionalProperties": False}}),
    "predict_power_cnn_pinn": (t_predict, {"description": "CNN-PINN prediction of one turbine's power (kW) for steady conditions, with a 90% conformal interval and the Betz/rated physics bound.", "input_schema": {"type": "object", "properties": {"wind_speed": {"type": "number"}, "wind_direction": {"type": "number"}, "temperature": {"type": "number", "description": "Outdoor °C (sets air density)"}, "wind_speed_std": {"type": "number"}}, "required": ["wind_speed"], "additionalProperties": False}}),
    "forecast_farm_power": (t_forecast, {"description": "Gradient-boosted forecast of 4-turbine farm power 1–24 h ahead from a historical issue time, with 90% intervals and the observed outcome.", "input_schema": {"type": "object", "properties": {"issue_time": {"type": "string", "description": "ISO timestamp within the record"}}, "required": ["issue_time"], "additionalProperties": False}}),
    "get_model_metrics": (t_model_metrics, {"description": "Held-out evaluation metrics, interval coverage and physics-violation audits for all trained models.", "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}}),
    "get_data_quality": (t_data_quality, {"description": "SCADA record span, per-channel missing shares, empty columns, and data absent from the repository.", "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}}),
    "get_hydro_site": (t_hydro_site, {"description": "Observed tidal-current statistics for a site code (e.g. FWS), or a list of all sites with the hydrokinetic equations when code is omitted.", "input_schema": {"type": "object", "properties": {"code": {"type": "string"}}, "additionalProperties": False}}),
    "estimate_hydrogen": (t_hydrogen, {"description": "Modeled hydrogen production over the SCADA record from observed farm power with the measured electrolyzer curve.", "input_schema": {"type": "object", "properties": {"modules": {"type": "integer", "minimum": 1, "maximum": 40}, "staging": {"type": "string", "enum": ["optimal", "sequential"]}, "storage_kwh": {"type": "number", "minimum": 0}}, "additionalProperties": False}}),
    "draft_operator_instruction": (t_draft_instruction, {"description": "Record a DRAFT operator instruction for human review. It is never executed.", "input_schema": {"type": "object", "properties": {"turbine": {"type": "string"}, "change": {"type": "string"}, "reason": {"type": "string"}, "expected_effect": {"type": "string"}, "constraints": {"type": "array", "items": {"type": "string"}}, "confidence": {"type": "string"}, "source": {"type": "string"}}, "required": ["turbine", "change", "reason", "expected_effect", "constraints", "confidence", "source"], "additionalProperties": False}}),
}

TOOL_DEFS = [{"name": n, **spec} for n, (_, spec) in TOOLS.items()]


def _client():
    import anthropic  # noqa: PLC0415

    return anthropic.Anthropic()


def chat(conversation_id: str, message: str, context: dict[str, Any], client=None) -> dict[str, Any]:
    client = client or _client()
    with _lock:
        history = _conversations.setdefault(conversation_id, [])
        history.append({"role": "user", "content": message})
        messages = list(history)
    tool_calls: list[dict[str, str]] = []
    references: list[dict[str, str]] = []
    instruction = None
    response = None
    for _ in range(MAX_TOOL_ROUNDS):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            tools=TOOL_DEFS,
            messages=messages,
            output_config={"effort": "medium"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "refusal":
            break
        if response.stop_reason != "tool_use":
            break
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            fn = TOOLS.get(block.name, (None,))[0]
            try:
                out = fn(context, **(block.input or {})) if fn else {"error": f"Unknown tool {block.name}"}
                is_error = "error" in out
            except Exception as exc:  # noqa: BLE001
                out, is_error = {"error": f"{type(exc).__name__}: {exc}"}, True
            if block.name == "draft_operator_instruction" and not is_error:
                instruction = block.input
            tool_calls.append({"name": block.name, "summary": json.dumps(block.input)[:160]})
            references.append({"label": block.name, "kind": "tool", "detail": "error" if is_error else "ok"})
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(out, default=str)[:60000], "is_error": is_error})
        messages.append({"role": "user", "content": results})
    with _lock:
        _conversations[conversation_id] = messages
    if response is None:
        raise RuntimeError("No response from the model.")
    if response.stop_reason == "refusal":
        answer = "The model declined this request. Try rephrasing it as an engineering question about the project data."
    else:
        answer = "\n".join(b.text for b in response.content if b.type == "text").strip() or f"Stopped after {MAX_TOOL_ROUNDS} tool rounds without a final answer."
    return {"answer": answer, "references": references, "tool_calls": tool_calls, "instruction": instruction, "model": getattr(response, "model", MODEL)}
