"""Learned farm-power forecaster with quantile intervals.

Target: hourly 4-turbine farm power (kW) h hours ahead, h ∈ {1, 3, 6, 12, 24}.
Model: scikit-learn HistGradientBoostingRegressor per horizon (squared error for
the point forecast, quantile loss at 5 % / 95 % for the interval). Features use
only information available at the issue time t: lagged farm power and wind,
direction, and calendar terms. Same time-aware split as all other models.

    backend/.venv/Scripts/python ml/train_forecaster.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MODEL_DIR, SPLIT, TURBINES, VAL_START, load_scada, metrics, now_iso, rnd, update_report  # noqa: E402

HORIZONS = [1, 3, 6, 12, 24]
# Physical floor: 4 turbines × the most negative observed P_avg (parasitic load, ≈ −17 kW each).
FARM_FLOOR_KW = -70.0
LAGS = [0, 1, 2, 3, 6, 12, 24]


def hourly_farm(df: pd.DataFrame) -> pd.DataFrame:
    g = df.set_index("t").groupby("Wind_turbine_name")
    P = g["P_avg"].resample("h").mean().unstack(0)[TURBINES]
    W = g["Ws_avg"].resample("h").mean().unstack(0)[TURBINES]
    rad = np.deg2rad(df.set_index("t")["Wa_avg"])
    s = np.sin(rad).resample("h").mean()
    c = np.cos(rad).resample("h").mean()
    out = pd.DataFrame({"P": P.sum(axis=1, min_count=4), "W": W.mean(axis=1), "dir_s": s, "dir_c": c})
    full = pd.date_range(out.index.min(), out.index.max(), freq="h")
    return out.reindex(full)


def features(h: pd.DataFrame) -> pd.DataFrame:
    X = pd.DataFrame(index=h.index)
    for lag in LAGS:
        X[f"P_lag{lag}"] = h["P"].shift(lag)
        X[f"W_lag{lag}"] = h["W"].shift(lag)
    X["dP_1"] = h["P"] - h["P"].shift(1)
    X["dW_1"] = h["W"] - h["W"].shift(1)
    X["P_mean6"] = h["P"].rolling(6, min_periods=3).mean()
    X["W_mean6"] = h["W"].rolling(6, min_periods=3).mean()
    X["dir_s"] = h["dir_s"]
    X["dir_c"] = h["dir_c"]
    hod = h.index.hour
    doy = h.index.dayofyear
    X["hod_s"], X["hod_c"] = np.sin(2 * np.pi * hod / 24), np.cos(2 * np.pi * hod / 24)
    X["doy_s"], X["doy_c"] = np.sin(2 * np.pi * doy / 365), np.cos(2 * np.pi * doy / 365)
    return X


def main():
    t0 = time.time()
    h = hourly_farm(load_scada())
    X = features(h)
    rows = []
    models = {}
    window = {}
    for hz in HORIZONS:
        y = h["P"].shift(-hz)
        valid = y.notna() & X["P_lag0"].notna() & X["W_lag0"].notna()
        idx = X.index[valid]
        tr = idx[idx < VAL_START]
        va = idx[(idx >= VAL_START) & (idx < SPLIT)]
        # Targets must also lie before the split for train/val rows (no leakage across the boundary).
        tr = tr[tr + pd.Timedelta(hours=hz) < VAL_START]
        va = va[va + pd.Timedelta(hours=hz) < SPLIT]
        te = idx[idx >= SPLIT]
        common = dict(max_iter=400, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40, l2_regularization=1.0, random_state=0)
        point = HistGradientBoostingRegressor(early_stopping=True, validation_fraction=None, n_iter_no_change=20, **common)
        point.fit(pd.concat([X.loc[tr], X.loc[va]]), pd.concat([y.loc[tr], y.loc[va]]), sample_weight=None)
        lo = HistGradientBoostingRegressor(loss="quantile", quantile=0.05, **common).fit(X.loc[tr], y.loc[tr])
        hi = HistGradientBoostingRegressor(loss="quantile", quantile=0.95, **common).fit(X.loc[tr], y.loc[tr])
        # Conformalized quantile regression (Romano et al. 2019): widen the quantile band by the
        # 90th percentile of conformity scores on the September validation month.
        yv = y.loc[va].to_numpy()
        conf = np.maximum(lo.predict(X.loc[va]) - yv, yv - hi.predict(X.loc[va]))
        q = float(np.quantile(conf, min(1.0, 0.9 * (1 + 1 / len(conf)))))
        pred = np.maximum(point.predict(X.loc[te]), FARM_FLOOR_KW)
        raw_lo, raw_hi = lo.predict(X.loc[te]), hi.predict(X.loc[te])
        plo, phi = np.maximum(raw_lo - q, FARM_FLOOR_KW), raw_hi + q
        obs = y.loc[te].to_numpy()
        persistence = X.loc[te, "P_lag0"].to_numpy()
        rows.append({
            "horizonH": hz,
            "model": metrics(obs, pred),
            "persistence": metrics(obs, persistence),
            "skillVsPersistence": round(1 - metrics(obs, pred)["rmse"] / metrics(obs, persistence)["rmse"], 4),
            "intervalCoverage": round(float(np.mean((obs >= plo) & (obs <= phi))), 4),
            "rawQuantileCoverage": round(float(np.mean((obs >= raw_lo) & (obs <= raw_hi))), 4),
            "conformalWideningKw": round(q, 1),
            "meanIntervalWidthKw": round(float(np.mean(phi - plo)), 1),
        })
        models[hz] = {"point": point, "lo": lo, "hi": hi, "conformal_q": q}
        if hz == 6:
            sel = (te >= pd.Timestamp("2017-12-01", tz="UTC")) & (te < pd.Timestamp("2017-12-15", tz="UTC"))
            tgt = te[sel] + pd.Timedelta(hours=hz)
            window = {"t": [x.isoformat() for x in tgt], "observed": rnd(obs[sel], 1), "forecast": rnd(pred[sel], 1), "lo": rnd(plo[sel], 1), "hi": rnd(phi[sel], 1), "persistence": rnd(persistence[sel], 1)}
        print(f"  h={hz:2d}  RMSE {rows[-1]['model']['rmse']:.0f} vs persistence {rows[-1]['persistence']['rmse']:.0f}  coverage {rows[-1]['intervalCoverage']:.3f}")
    joblib.dump({"floor_kw": FARM_FLOOR_KW, "models": models, "features": list(X.columns), "horizons": HORIZONS, "trained_at": now_iso()}, MODEL_DIR / "forecaster.joblib")
    update_report("forecaster", {
        "id": "gbm-forecaster",
        "name": "Gradient-boosted farm-power forecaster",
        "status": "trained",
        "trainedAt": now_iso(),
        "artifact": "models/forecaster.joblib",
        "code": "ml/train_forecaster.py",
        "method": "HistGradientBoostingRegressor per horizon; 5 %/95 % quantile models conformalized on the Sep 2017 validation month (CQR) for a 90 % interval",
        "features": list(X.columns),
        "target": "4-turbine farm hourly mean power (kW) at t + h; hours with any turbine missing excluded",
        "horizons": rows,
        "window6h": window,
        "trainingSeconds": round(time.time() - t0, 1),
    })


if __name__ == "__main__":
    main()
