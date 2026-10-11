"""Shared data loading and evaluation utilities for AeroHydro-PINN models.

All models use the same time-aware split as scripts/build_frontend_data.py:
train < 2017-10-01 (UTC), test >= 2017-10-01. The last month of the training
period (September 2017) is held out for early stopping / calibration, so the
test period is never used for any fitting decision.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WIND_CSV = ROOT / "data" / "raw" / "wind" / "la-haute-borne-data-2017-2020.csv"
MODEL_DIR = ROOT / "models"
REPORT_DIR = ROOT / "frontend" / "public" / "data"
MODEL_DIR.mkdir(exist_ok=True)

SPLIT = pd.Timestamp("2017-10-01T00:00:00Z")
VAL_START = pd.Timestamp("2017-09-01T00:00:00Z")
TURBINES = ["R80711", "R80721", "R80736", "R80790"]

ROTOR_D = 82.0  # m — public Senvion MM82 spec (assumption; see docs/AUDIT.md)
AREA = math.pi * (ROTOR_D / 2) ** 2
BETZ = 16 / 27
R_AIR = 287.05  # J/(kg K)
P_ATM = 101325.0  # Pa — sea-level standard pressure (assumption; no pressure channel in SCADA)

USECOLS = ["Wind_turbine_name", "Date_time", "P_avg", "Ws_avg", "Ws_std", "Wa_avg", "Ot_avg", "Ba_avg", "Rs_avg", "Gost_avg", "Ds_avg"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_scada() -> pd.DataFrame:
    df = pd.read_csv(WIND_CSV, sep=";", usecols=USECOLS)
    df["t"] = pd.to_datetime(df["Date_time"], utc=True)
    df = df.drop(columns="Date_time").drop_duplicates(["Wind_turbine_name", "t"], keep="first")
    return df.sort_values(["Wind_turbine_name", "t"]).reset_index(drop=True)


def rated_kw(df: pd.DataFrame) -> float:
    return float(df["P_avg"].quantile(0.9995))


def air_density(temp_c):
    """Ideal-gas density from outdoor temperature at standard pressure (kg/m3)."""
    return P_ATM / (R_AIR * (np.asarray(temp_c, dtype="float64") + 273.15))


def betz_power_kw(ws, rho):
    return 0.5 * rho * AREA * np.asarray(ws, dtype="float64") ** 3 * BETZ / 1000.0


def metrics(y, yhat) -> dict:
    y = np.asarray(y, float)
    yhat = np.asarray(yhat, float)
    m = np.isfinite(y) & np.isfinite(yhat)
    y, yhat = y[m], yhat[m]
    err = yhat - y
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    return {
        "mae": round(float(np.mean(np.abs(err))), 3),
        "rmse": round(float(np.sqrt(np.mean(err**2))), 3),
        "r2": round(1 - float(np.sum(err**2)) / ss_tot, 4) if ss_tot > 0 else None,
        "bias": round(float(np.mean(err)), 3),
        "n": int(m.sum()),
    }


def rnd(values, digits=2):
    arr = np.round(np.asarray(values, dtype="float64"), digits)
    return [None if not np.isfinite(v) else float(v) for v in arr]


def conformal_bins(ws_val, resid_val, edges, alpha=0.10):
    """Per-wind-speed-bin split-conformal residual quantiles from a calibration set."""
    lo, hi = [], []
    idx = np.clip(np.digitize(ws_val, edges) - 1, 0, len(edges) - 2)
    for b in range(len(edges) - 1):
        r = resid_val[idx == b]
        if len(r) < 30:
            r = resid_val
        lo.append(float(np.quantile(r, alpha / 2)))
        hi.append(float(np.quantile(r, 1 - alpha / 2)))
    return np.array(lo), np.array(hi)


def apply_bins(ws, edges, values):
    idx = np.clip(np.digitize(ws, edges) - 1, 0, len(edges) - 2)
    return values[idx]


def update_report(key: str, payload: dict) -> None:
    """Merge one model's results into frontend/public/data/ml_models.json."""
    path = REPORT_DIR / "ml_models.json"
    report = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    report[key] = payload
    report["generatedAt"] = now_iso()
    path.write_text(json.dumps(report, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(f"  updated {path.relative_to(ROOT)} [{key}] ({path.stat().st_size / 1024:.0f} KB)")
