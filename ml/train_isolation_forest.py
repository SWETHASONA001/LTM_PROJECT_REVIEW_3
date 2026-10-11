"""Isolation Forest anomaly detector on multivariate SCADA states.

Features per 10-minute record: wind speed, normalised power, power-curve
residual, rotor speed, pitch, gearbox oil temperature minus outdoor
temperature, generator speed. Fitted on the training period only; scored on
the full record. Records are flagged above the training 99th-percentile score,
and events are runs of >= 3 consecutive flagged records (30 min), matching the
residual detector so the two can be compared.

    backend/.venv/Scripts/python ml/train_isolation_forest.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MODEL_DIR, SPLIT, load_scada, now_iso, rated_kw, update_report  # noqa: E402

FEATURES = ["Ws_avg", "P_norm", "resid_norm", "Rs_avg", "Ba_avg", "gear_dT", "Ds_avg"]


def power_curve(train: pd.DataFrame):
    edges = np.arange(0, 26, 0.5)
    b = np.clip(np.digitize(train["Ws_avg"], edges) - 1, 0, len(edges) - 2)
    med = train.groupby(b)["P_avg"].median().reindex(range(len(edges) - 1)).interpolate().bfill().ffill().to_numpy()
    return edges[:-1] + 0.25, med


def main():
    t0 = time.time()
    df = load_scada()
    rated = rated_kw(df)
    df = df.dropna(subset=["Ws_avg", "P_avg", "Rs_avg", "Ba_avg", "Gost_avg", "Ot_avg", "Ds_avg"]).copy()
    train = df[df["t"] < SPLIT]
    ws_c, med = power_curve(train)
    df["P_norm"] = df["P_avg"] / rated
    df["resid_norm"] = (df["P_avg"] - np.interp(df["Ws_avg"], ws_c, med)) / rated
    df["gear_dT"] = df["Gost_avg"] - df["Ot_avg"]
    tr = df["t"] < SPLIT
    model = IsolationForest(n_estimators=300, max_samples=4096, contamination="auto", random_state=0, n_jobs=-1)
    model.fit(df.loc[tr, FEATURES])
    score = -model.score_samples(df[FEATURES])  # higher = more anomalous
    threshold = float(np.quantile(score[tr.to_numpy()], 0.99))
    df["score"] = score
    df["flag"] = score > threshold
    events = []
    for tid, g in df.sort_values("t").groupby("Wind_turbine_name"):
        g = g.reset_index(drop=True)
        gap = g["t"].diff().dt.total_seconds().fillna(600) > 600
        run = ((g["flag"] != g["flag"].shift()) | gap).cumsum()
        for _, r in g[g["flag"]].groupby(run[g["flag"]]):
            if len(r) < 3:
                continue
            # Which feature deviates most from its training median (in training-IQR units)?
            z = {}
            for f in FEATURES:
                q1, q3 = train_q[f]
                z[f] = float(abs(r[f].median() - (q1 + q3) / 2) / max(q3 - q1, 1e-6))
            events.append({
                "turbine": tid, "start": r["t"].iloc[0].isoformat(), "end": (r["t"].iloc[-1] + pd.Timedelta(minutes=10)).isoformat(),
                "durationH": round(len(r) / 6, 2), "meanScore": round(float(r["score"].mean()), 4),
                "meanWs": round(float(r["Ws_avg"].mean()), 2), "meanPowerKw": round(float(r["P_avg"].mean()), 1),
                "meanPitch": round(float(r["Ba_avg"].mean()), 2), "gearDeltaT": round(float(r["gear_dT"].mean()), 1),
                "dominantFeature": max(z, key=z.get),
            })
    events.sort(key=lambda e: (e["durationH"], e["meanScore"]), reverse=True)
    joblib.dump({"model": model, "features": FEATURES, "threshold": threshold, "rated_kw": rated, "curve": (ws_c.tolist(), med.tolist()), "trained_at": now_iso()}, MODEL_DIR / "isolation_forest.joblib")
    by_turbine = {tid: int(sum(1 for e in events if e["turbine"] == tid)) for tid in sorted(df["Wind_turbine_name"].unique())}
    dominant = pd.Series([e["dominantFeature"] for e in events]).value_counts().to_dict() if events else {}
    update_report("isolationForest", {
        "id": "isolation-forest",
        "name": "Isolation Forest anomaly detector",
        "status": "trained",
        "trainedAt": now_iso(),
        "artifact": "models/isolation_forest.joblib",
        "code": "ml/train_isolation_forest.py",
        "features": FEATURES,
        "method": "IsolationForest(300 trees, 4096 samples/tree) fitted on records before 2017-10-01; flag = score above the training 99th percentile; events = ≥3 consecutive flags",
        "threshold": round(threshold, 5),
        "flaggedRecordShare": round(float(df["flag"].mean()), 4),
        "testFlaggedShare": round(float(df.loc[~tr, "flag"].mean()), 4),
        "eventsByTurbine": by_turbine,
        "dominantFeatures": {k: int(v) for k, v in dominant.items()},
        "events": events[:400],
        "eventCount": len(events),
        "trainingSeconds": round(time.time() - t0, 1),
    })
    print(f"  {len(events)} events · flagged share {df['flag'].mean():.4f} · {time.time() - t0:.1f}s")


train_q: dict = {}

if __name__ == "__main__":
    # Training-period interquartile ranges, used to explain which feature drives each event.
    _df = load_scada()
    _rated = rated_kw(_df)
    _tr = _df[_df["t"] < SPLIT].dropna(subset=["Ws_avg", "P_avg", "Rs_avg", "Ba_avg", "Gost_avg", "Ot_avg", "Ds_avg"]).copy()
    _c, _m = power_curve(_tr)
    _tr["P_norm"] = _tr["P_avg"] / _rated
    _tr["resid_norm"] = (_tr["P_avg"] - np.interp(_tr["Ws_avg"], _c, _m)) / _rated
    _tr["gear_dT"] = _tr["Gost_avg"] - _tr["Ot_avg"]
    for _f in FEATURES:
        train_q[_f] = (float(_tr[_f].quantile(0.25)), float(_tr[_f].quantile(0.75)))
    del _df, _tr
    main()
