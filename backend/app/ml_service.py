"""Inference for the trained models in models/ (CNN-PINN, forecaster, Isolation Forest).

Artifacts are loaded lazily; a missing artifact or missing optional dependency
produces a clear 503 from the API rather than a fabricated prediction.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from typing import Any

import numpy as np

from . import config

ML_DIR = config.ROOT / "ml"
MODEL_DIR = config.ROOT / "models"
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))


class Unavailable(RuntimeError):
    pass


def _require(path):
    if not path.exists():
        raise Unavailable(f"Model artifact {path.relative_to(config.ROOT).as_posix()} not found. Train it with the matching ml/train_*.py script.")


@lru_cache(maxsize=1)
def _cnn():
    path = MODEL_DIR / "cnn_pinn.pt"
    _require(path)
    try:
        import cnn_pinn  # noqa: PLC0415
    except ImportError as exc:  # torch missing
        raise Unavailable(f"PyTorch is required for CNN-PINN inference: {exc}") from exc
    model, ckpt = cnn_pinn.load(path)
    return cnn_pinn, model, ckpt


def cnn_status() -> dict[str, Any]:
    try:
        _, _, ckpt = _cnn()
        return {"available": True, "trained_at": ckpt.get("trained_at")}
    except Unavailable as exc:
        return {"available": False, "reason": str(exc)}


def cnn_predict(ws: float, wa: float, ws_std: float | None, temperature: float) -> dict[str, Any]:
    from common import air_density, betz_power_kw  # noqa: PLC0415

    mod, model, ckpt = _cnn()
    std = 0.1 * ws if ws_std is None else ws_std
    p = float(mod.predict_kw(model, ckpt, mod.steady_window(ws, wa, std, temperature))[0])
    edges = np.array(ckpt["conformal_edges"])
    b = int(np.clip(np.digitize([ws], edges)[0] - 1, 0, len(edges) - 2))
    rho = float(air_density(temperature))
    cap = float(min(betz_power_kw(ws, rho), ckpt["rated_kw"]))
    return {
        "model": "cnn-pinn",
        "power_kw": round(p, 1),
        "interval_kw": [round(p + ckpt["conformal_lo"][b], 1), round(p + ckpt["conformal_hi"][b], 1)],
        "interval_nominal": 0.9,
        "physics_cap_kw": round(cap, 1),
        "air_density": round(rho, 4),
        "inputs": {"ws": ws, "wa": wa, "ws_std": std, "temperature": temperature, "window": "steady conditions over the last hour"},
        "provenance": "predicted",
    }


def cnn_curve(wa: float, temperature: float) -> dict[str, Any]:
    mod, model, ckpt = _cnn()
    ws = np.arange(0, 25.01, 0.5)
    X = np.concatenate([mod.steady_window(v, wa, 0.1 * v, temperature) for v in ws])
    p = mod.predict_kw(model, ckpt, X)
    return {"ws": ws.round(2).tolist(), "power_kw": np.round(p, 1).tolist(), "wa": wa, "temperature": temperature}


@lru_cache(maxsize=1)
def _forecaster():
    path = MODEL_DIR / "forecaster.joblib"
    _require(path)
    try:
        import joblib  # noqa: PLC0415
        import train_forecaster as tf  # noqa: PLC0415
        from common import WIND_CSV, load_scada  # noqa: PLC0415
    except ImportError as exc:
        raise Unavailable(f"scikit-learn/joblib are required for forecasting: {exc}") from exc
    if not WIND_CSV.exists():
        raise Unavailable("Raw SCADA CSV is not available on this host; forecasting needs the hourly farm history.")
    bundle = joblib.load(path)
    hourly = tf.hourly_farm(load_scada())
    feats = tf.features(hourly)
    return bundle, hourly, feats


def forecast(issue_time: str) -> dict[str, Any]:
    import pandas as pd  # noqa: PLC0415

    bundle, hourly, feats = _forecaster()
    t = pd.Timestamp(issue_time)
    t = t.tz_localize("UTC") if t.tzinfo is None else t.tz_convert("UTC")
    t = t.floor("h")
    if t not in feats.index:
        raise ValueError(f"Issue time outside the record ({feats.index.min()} – {feats.index.max()}).")
    row = feats.loc[[t]]
    if row[["P_lag0", "W_lag0"]].isna().any(axis=None):
        raise ValueError("Farm power or wind is missing at the issue time; no forecast can be issued.")
    floor = float(bundle.get("floor_kw", -70.0))
    out = []
    for h in bundle["horizons"]:
        m = bundle["models"][h]
        q = m.get("conformal_q", 0.0)
        target = t + pd.Timedelta(hours=h)
        obs = hourly["P"].get(target)
        out.append({
            "horizon_h": h,
            "target_time": target.isoformat(),
            "forecast_kw": round(max(float(m["point"].predict(row)[0]), floor), 1),
            "interval_kw": [round(max(float(m["lo"].predict(row)[0]) - q, floor), 1), round(float(m["hi"].predict(row)[0]) + q, 1)],
            "observed_kw": None if obs is None or not np.isfinite(obs) else round(float(obs), 1),
        })
    return {"issue_time": t.isoformat(), "observed_now_kw": round(float(hourly["P"].loc[t]), 1), "forecasts": out, "model": "gbm-forecaster", "provenance": "predicted"}
