"""Build compact, provenance-tagged JSON extracts of the real AeroHydro datasets.

The frontend never reads the raw CSV/NetCDF files directly (they are large and
local-only). This script reads them READ-ONLY and writes summaries into
``frontend/public/data``. Every output carries a ``provenance`` block that says
whether values are observed, processed real data, predicted, physics-derived,
simulated or optimized.

Run from the repository root:

    py -3.11 scripts/build_frontend_data.py

Requires: pandas, numpy, xarray, netCDF4.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "frontend" / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

WIND_CSV = RAW / "wind" / "la-haute-borne-data-2017-2020.csv"
ELEC_WIND_CSV = RAW / "electrolyzer" / "combined_wind_experiments.csv"
ELEC_HIST_CSV = RAW / "electrolyzer" / "combined_historical_wind_experiments.csv"
TIDAL_CSV = RAW / "hydro-electrolyzer" / "combined_simulated_tidal_experiments.csv"
HYDRO_DIR = RAW / "hydro"

GENERATED_AT = datetime.now(timezone.utc).isoformat(timespec="seconds")

# Train/test boundary for time-aware validation (no shuffling, no leakage).
SPLIT_UTC = pd.Timestamp("2017-10-01T00:00:00Z")

RHO_AIR = 1.225  # kg/m3, standard sea-level air density (assumption)
RHO_SEA = 1025.0  # kg/m3, typical seawater density (assumption)
HYDRO_CUT_IN = 0.75  # m/s, "minimum operation speed" defined in README_648.txt


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def rnd(values, digits=2):
    """Round an array to a JSON-friendly list with None for NaN."""
    arr = np.asarray(values, dtype="float64")
    out = np.round(arr, digits)
    return [None if not np.isfinite(v) else float(v) for v in out]


def write(name: str, payload: dict) -> None:
    path = OUT / name
    path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(f"  wrote {rel(path)} ({path.stat().st_size / 1024:.0f} KB)")


def metrics(y, yhat) -> dict:
    y = np.asarray(y, float)
    yhat = np.asarray(yhat, float)
    m = np.isfinite(y) & np.isfinite(yhat)
    y, yhat = y[m], yhat[m]
    err = yhat - y
    ss_res = float(np.sum(err ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    return {
        "mae": round(float(np.mean(np.abs(err))), 3),
        "rmse": round(float(np.sqrt(np.mean(err ** 2))), 3),
        "r2": round(1 - ss_res / ss_tot, 4) if ss_tot > 0 else None,
        "bias": round(float(np.mean(err)), 3),
        "n": int(m.sum()),
    }


# --------------------------------------------------------------------------
# Wind SCADA (La Haute Borne)
# --------------------------------------------------------------------------

# Channel meanings follow the ENGIE La Haute Borne open-data dictionary. The
# dictionary itself is NOT in this repository, so descriptions are flagged
# "verify" in the UI. Only channels that actually contain data are exported.
CHANNELS = {
    "P_avg": ("Active power", "kW"),
    "Ws_avg": ("Wind speed (nacelle anemometer, mean of Ws1/Ws2)", "m/s"),
    "Wa_avg": ("Absolute wind direction", "deg"),
    "Ya_avg": ("Nacelle angle", "deg"),
    "Rs_avg": ("Rotor speed", "rpm"),
    "Ba_avg": ("Blade pitch angle", "deg"),
    "Ot_avg": ("Outdoor temperature", "degC"),
    "Ds_avg": ("Generator speed", "rpm"),
    "Gost_avg": ("Gearbox oil sump temperature", "degC"),
    "Q_avg": ("Reactive power", "kVAr"),
}


def build_wind() -> dict:
    print("Wind SCADA ...")
    usecols = ["Wind_turbine_name", "Date_time", "Ws_std"] + list(CHANNELS)
    df = pd.read_csv(WIND_CSV, sep=";", usecols=usecols)
    n_raw = len(df)
    df["t"] = pd.to_datetime(df["Date_time"], utc=True)
    dup_rows = int(df.duplicated(["Wind_turbine_name", "t"], keep=False).sum())
    df = df.drop_duplicates(["Wind_turbine_name", "t"], keep="first").drop(columns="Date_time")
    turbines = sorted(df["Wind_turbine_name"].unique().tolist())

    # Full-file column audit (header only + emptiness from the audit report).
    header = pd.read_csv(WIND_CSV, sep=";", nrows=0).columns.tolist()
    empty_cols = ["Pas_avg", "Pas_min", "Pas_max", "Pas_std", "Wa_c_min", "Wa_c_max",
                  "Wa_c_std", "Na_c_min", "Na_c_max", "Na_c_std"]

    # ---- Empirical power curve (fleet) ------------------------------------
    valid = df.dropna(subset=["P_avg", "Ws_avg"])
    bins = np.arange(0, 25.5, 0.5)
    valid = valid.assign(bin=pd.cut(valid["Ws_avg"], bins, right=False, labels=bins[:-1] + 0.25))
    pc = valid.groupby("bin", observed=True)["P_avg"].agg(
        median="median", mean="mean", p10=lambda s: s.quantile(0.1),
        p90=lambda s: s.quantile(0.9), count="size")
    rated_kw = float(valid["P_avg"].quantile(0.9995))
    pc_ws = pc.index.astype(float).to_numpy()
    pc_med = pc["median"].to_numpy()
    # Monotone smoothing for the engineering curve used by the wake model:
    # running max, clip to [0, rated], bins above 13 m/s with <30 samples -> rated.
    eng = np.clip(np.maximum.accumulate(np.clip(pc_med, 0, None)), 0, rated_kw)
    sparse = (pc["count"].to_numpy() < 30) & (pc_ws > 13)
    eng[sparse] = rated_kw
    eng[pc_ws < 2.5] = 0.0

    per_turbine_pc = {}
    for tid, g in valid.groupby("Wind_turbine_name"):
        s = g.groupby("bin", observed=True)["P_avg"].median()
        per_turbine_pc[tid] = {"ws": rnd(s.index.astype(float), 2), "p": rnd(s.values, 1)}

    # ---- Turbulence intensity estimate (Ws_std / Ws_avg) ------------------
    ti_src = df[(df["Ws_avg"] >= 4) & df["Ws_std"].notna()]
    ti = (ti_src["Ws_std"] / ti_src["Ws_avg"]).clip(0, 1)
    ti_median = float(ti.median())

    # ---- Wind resource (direction x speed frequency) ----------------------
    wr = df.dropna(subset=["Ws_avg", "Wa_avg"])
    n_sec = 12
    sec = ((wr["Wa_avg"] % 360 + 180 / n_sec) // (360 / n_sec)).astype(int) % n_sec
    spd_edges = np.arange(0, 26, 1.0)
    spd = np.clip(np.digitize(wr["Ws_avg"], spd_edges) - 1, 0, len(spd_edges) - 2)
    freq = np.zeros((n_sec, len(spd_edges) - 1))
    np.add.at(freq, (sec.to_numpy(), spd), 1)
    freq /= freq.sum()

    rose_edges = [0, 3, 6, 9, 12, 99]
    rose_sec = ((wr["Wa_avg"] % 360 + 11.25) // 22.5).astype(int) % 16
    rose_spd = np.clip(np.digitize(wr["Ws_avg"], rose_edges) - 1, 0, 4)
    rose = np.zeros((16, 5))
    np.add.at(rose, (rose_sec.to_numpy(), rose_spd), 1)
    rose = rose / rose.sum() * 100

    # ---- Hourly per-turbine series for twin timeline / charts ------------
    start = pd.Timestamp("2017-01-01T00:00:00Z")
    end = df["t"].max().floor("h")
    hours = pd.date_range(start, end, freq="h")
    hourly = {}
    hourly_fields = ["P_avg", "Ws_avg", "Wa_avg", "Rs_avg", "Ba_avg", "Ot_avg", "Ya_avg"]
    for tid, g in df.groupby("Wind_turbine_name"):
        g = g.set_index("t").sort_index()
        mean = g[hourly_fields].resample("h").mean()
        # Circular mean for direction channels.
        for col in ["Wa_avg", "Ya_avg"]:
            rad = np.deg2rad(g[col])
            s = np.sin(rad).resample("h").mean()
            c = np.cos(rad).resample("h").mean()
            mean[col] = (np.rad2deg(np.arctan2(s, c)) + 360) % 360
        count = g["P_avg"].resample("h").count()
        mean = mean.reindex(hours)
        count = count.reindex(hours).fillna(0)
        hourly[tid] = {
            "P": rnd(mean["P_avg"], 1), "Ws": rnd(mean["Ws_avg"], 2), "Wa": rnd(mean["Wa_avg"], 1),
            "Rs": rnd(mean["Rs_avg"], 2), "Ba": rnd(mean["Ba_avg"], 2), "Ot": rnd(mean["Ot_avg"], 1),
            "Ya": rnd(mean["Ya_avg"], 1), "n": [int(v) for v in count.to_numpy()],
        }

    # ---- Per-turbine statistics ------------------------------------------
    stats = []
    monthly = []
    for tid, g in df.groupby("Wind_turbine_name"):
        p = g["P_avg"]
        energy_mwh = float(p.clip(lower=0).sum() / 6 / 1000)  # 10-min kW -> MWh
        stats.append({
            "id": tid,
            "records": int(len(g)),
            "start": g["t"].min().isoformat(),
            "end": g["t"].max().isoformat(),
            "meanPowerKw": round(float(p.mean()), 1),
            "maxPowerKw": round(float(p.max()), 1),
            "meanWindSpeed": round(float(g["Ws_avg"].mean()), 2),
            "energyMWh": round(energy_mwh, 1),
            "capacityFactor": round(float(p.clip(lower=0).mean() / rated_kw), 4),
            "zeroOrNegativePowerShare": round(float((p <= 0).mean()), 4),
            "missing": {c: round(float(g[c].isna().mean()), 4) for c in CHANNELS},
        })
        m = g.set_index("t")["P_avg"].clip(lower=0).resample("MS").agg(["sum", "count"])
        for ts, row in m.iterrows():
            monthly.append({"turbine": tid, "month": ts.strftime("%Y-%m"),
                            "energyMWh": round(float(row["sum"]) / 6 / 1000, 2),
                            "coverage": round(float(row["count"]) / (ts.days_in_month * 144), 4)})

    channel_missing = {c: round(float(df[c].isna().mean()), 4) for c in CHANNELS}

    wind = {
        "provenance": {
            "kind": "processed",
            "source": rel(WIND_CSV),
            "method": "10-min SCADA records, duplicates on (turbine, timestamp) dropped (first kept); "
                      "hourly means (circular mean for directions); timestamps converted to UTC.",
            "generatedAt": GENERATED_AT,
        },
        "site": {"name": "La Haute Borne (ENGIE open data)", "country": "France",
                 "coordinatesAvailable": False},
        "turbines": turbines,
        "rawRows": n_raw,
        "duplicateKeyRows": dup_rows,
        "columnsInFile": len(header),
        "emptyColumns": empty_cols,
        "timeRange": {"start": df["t"].min().isoformat(), "end": df["t"].max().isoformat()},
        "samplingSeconds": 600,
        "channels": [{"key": k, "label": v[0], "unit": v[1], "missingShare": channel_missing[k]}
                     for k, v in CHANNELS.items()],
        "turbineStats": stats,
        "monthly": monthly,
        "ratedPowerKwObserved": round(rated_kw, 1),
        "tiMedian": round(ti_median, 4),
        "powerCurve": {
            "provenance": {"kind": "processed", "method": "Binned (0.5 m/s) statistics of P_avg vs Ws_avg, all valid records."},
            "ws": rnd(pc_ws, 2), "median": rnd(pc_med, 1), "mean": rnd(pc["mean"], 1),
            "p10": rnd(pc["p10"], 1), "p90": rnd(pc["p90"], 1),
            "count": [int(c) for c in pc["count"]],
            "engineering": rnd(eng, 1),
            "engineeringMethod": "Median curve, running-max monotone, clipped to [0, rated]; "
                                 "bins >13 m/s with <30 samples set to rated; 0 below 2.5 m/s.",
            "perTurbine": per_turbine_pc,
        },
        "resource": {
            "provenance": {"kind": "processed", "method": "Joint frequency of Wa_avg (12 sectors, centred on 0 deg) and Ws_avg (1 m/s bins), all turbines, all valid 10-min records."},
            "sectors": n_sec, "speedEdges": spd_edges.tolist(),
            "freq": [rnd(row, 6) for row in freq],
        },
        "rose": {
            "sectors": 16, "speedBins": ["0-3", "3-6", "6-9", "9-12", "12+"],
            "percent": [rnd(row, 3) for row in rose],
        },
    }
    write("wind_summary.json", wind)
    write("wind_hourly.json", {
        "provenance": wind["provenance"],
        "start": hours[0].isoformat(), "stepHours": 1, "length": len(hours),
        "fields": {"P": "kW", "Ws": "m/s", "Wa": "deg", "Rs": "rpm", "Ba": "deg", "Ot": "degC", "Ya": "deg",
                   "n": "count of 10-min records in hour (max 6)"},
        "turbines": hourly,
    })

    # ---- Baseline models with time-aware validation ----------------------
    print("Baseline models ...")
    build_models(valid, df, pc_ws, eng, rated_kw)
    return wind


def bin_curve(train: pd.DataFrame, value="P_avg", width=0.5):
    edges = np.arange(0, 26, width)
    b = np.clip(np.digitize(train["Ws_avg"], edges) - 1, 0, len(edges) - 2)
    g = train.groupby(b)[value]
    centers = edges[:-1] + width / 2
    med = np.full(len(centers), np.nan)
    q05 = np.full(len(centers), np.nan)
    q95 = np.full(len(centers), np.nan)
    for k, s in g:
        if len(s) >= 5:
            med[k] = s.mean()
            q05[k] = s.quantile(0.05)
            q95[k] = s.quantile(0.95)
    # forward fill gaps
    for arr in (med, q05, q95):
        idx = np.where(np.isfinite(arr))[0]
        if len(idx):
            arr[:] = np.interp(np.arange(len(arr)), idx, arr[idx])
    return edges, centers, med, q05, q95


def predict_curve(ws, centers, values):
    return np.interp(ws, centers, values)


def build_models(valid: pd.DataFrame, df: pd.DataFrame, pc_ws, eng, rated_kw):
    valid = valid.drop(columns="bin")
    train = valid[valid["t"] < SPLIT_UTC]
    test = valid[valid["t"] >= SPLIT_UTC]

    # Model A: fleet binned-mean power curve.
    _, c, mean_curve, q05, q95 = bin_curve(train)
    yhat_a = predict_curve(test["Ws_avg"], c, mean_curve)
    lo = predict_curve(test["Ws_avg"], c, q05)
    hi = predict_curve(test["Ws_avg"], c, q95)
    coverage = float(((test["P_avg"] >= lo) & (test["P_avg"] <= hi)).mean())

    # Model B: per-turbine binned-mean curve.
    yhat_b = np.full(len(test), np.nan)
    per_turbine_metrics = {}
    for tid in sorted(valid["Wind_turbine_name"].unique()):
        tr = train[train["Wind_turbine_name"] == tid]
        mask = (test["Wind_turbine_name"] == tid).to_numpy()
        _, ct, mc, _, _ = bin_curve(tr)
        yhat_b[mask] = predict_curve(test.loc[mask, "Ws_avg"], ct, mc)
        per_turbine_metrics[tid] = {
            "fleetCurve": metrics(test.loc[mask, "P_avg"], yhat_a[mask]),
            "turbineCurve": metrics(test.loc[mask, "P_avg"], yhat_b[mask]),
        }

    # Model C: physics reference (actuator-disc with constant Cp, capped at rated).
    area = math.pi * 41.0 ** 2  # 82 m rotor, public spec (see UI note)
    cp_ref = 0.45
    yhat_c = np.minimum(0.5 * RHO_AIR * area * test["Ws_avg"].to_numpy() ** 3 * cp_ref / 1000, rated_kw)
    yhat_c[test["Ws_avg"].to_numpy() < 3.0] = 0

    resid = (test["P_avg"].to_numpy() - yhat_a)
    hist_edges = np.arange(-1000, 1001, 50)
    hist, _ = np.histogram(np.clip(resid, -999, 999), hist_edges)

    rng = np.random.default_rng(7)
    sample_idx = rng.choice(len(test), size=min(1500, len(test)), replace=False)
    scatter = {
        "ws": rnd(test["Ws_avg"].to_numpy()[sample_idx], 2),
        "observed": rnd(test["P_avg"].to_numpy()[sample_idx], 1),
        "predicted": rnd(yhat_a[sample_idx], 1),
    }

    # Residual by wind-speed bin (test).
    rb = pd.DataFrame({"ws": test["Ws_avg"].to_numpy(), "r": resid})
    rb["bin"] = np.clip(np.floor(rb["ws"]), 0, 20)
    rbin = rb.groupby("bin")["r"].agg(["mean", "std", "count"]).reset_index()

    # Prediction series for one test week (R80711) for charting.
    week = test[(test["Wind_turbine_name"] == "R80711") &
                (test["t"] >= pd.Timestamp("2017-11-06T00:00:00Z")) &
                (test["t"] < pd.Timestamp("2017-11-13T00:00:00Z"))].sort_values("t")
    wk_hat = predict_curve(week["Ws_avg"], c, mean_curve)
    wk_lo = predict_curve(week["Ws_avg"], c, q05)
    wk_hi = predict_curve(week["Ws_avg"], c, q95)

    models = {
        "generatedAt": GENERATED_AT,
        "split": {"method": "time-aware holdout (no shuffling)",
                  "trainEnd": SPLIT_UTC.isoformat(), "testStart": SPLIT_UTC.isoformat(),
                  "trainRows": int(len(train)), "testRows": int(len(test)),
                  "target": "P_avg (kW, 10-min mean)", "features": ["Ws_avg"]},
        "models": [
            {"id": "fleet-power-curve", "name": "Fleet empirical power curve",
             "family": "Binned regression (0.5 m/s bins, mean)", "status": "trained",
             "provenance": "predicted",
             "description": "Mean P_avg per wind-speed bin learned from the training period for all four turbines.",
             "metrics": metrics(test["P_avg"], yhat_a),
             "interval": {"method": "Empirical 5-95% quantiles of training power per bin",
                          "nominal": 0.90, "testCoverage": round(coverage, 4)}},
            {"id": "turbine-power-curve", "name": "Per-turbine empirical power curve",
             "family": "Binned regression per turbine", "status": "trained", "provenance": "predicted",
             "description": "Separate binned curve for each turbine; captures turbine-specific behaviour.",
             "metrics": metrics(test["P_avg"], yhat_b)},
            {"id": "physics-reference", "name": "Physics reference (actuator disc)",
             "family": "P = 0.5 rho A Cp v^3, capped at rated", "status": "reference",
             "provenance": "physics",
             "description": f"No learning. rho={RHO_AIR} kg/m3, D=82 m (public spec), Cp={cp_ref} assumed, cut-in 3 m/s.",
             "metrics": metrics(test["P_avg"], yhat_c)},
        ],
        "notImplemented": [
            {"id": "cnn-pinn", "name": "CNN-PINN wind-power model",
             "reason": "No model code or trained weights exist in the repository."},
            {"id": "physics-gnn", "name": "Dynamic Physics-GNN turbine interaction",
             "reason": "No implementation or artifacts found."},
            {"id": "isolation-forest", "name": "Isolation Forest anomaly detector",
             "reason": "scikit-learn is not installed and no artifact exists; a power-curve residual detector is used instead."},
        ],
        "perTurbine": per_turbine_metrics,
        "residualHistogram": {"edges": hist_edges.tolist(), "counts": hist.tolist()},
        "residualByWs": {"ws": rbin["bin"].tolist(), "mean": rnd(rbin["mean"], 1),
                         "std": rnd(rbin["std"], 1), "count": rbin["count"].astype(int).tolist()},
        "scatter": scatter,
        "curve": {"ws": rnd(c, 2), "mean": rnd(mean_curve, 1), "q05": rnd(q05, 1), "q95": rnd(q95, 1)},
        "testWeek": {"turbine": "R80711", "t": [x.isoformat() for x in week["t"]],
                     "observed": rnd(week["P_avg"], 1), "predicted": rnd(wk_hat, 1),
                     "lo": rnd(wk_lo, 1), "hi": rnd(wk_hi, 1), "ws": rnd(week["Ws_avg"], 2)},
    }
    write("models.json", models)

    # ---- Anomaly events: sustained under-performance ----------------------
    allv = valid.sort_values(["Wind_turbine_name", "t"]).copy()
    allv["expected"] = predict_curve(allv["Ws_avg"], c, mean_curve)
    allv["lo"] = predict_curve(allv["Ws_avg"], c, q05)
    op = allv["Ws_avg"].between(4.0, 20.0)
    allv["flag"] = op & (allv["P_avg"] < allv["lo"]) & ((allv["expected"] - allv["P_avg"]) > 100)
    events = []
    for tid, g in allv.groupby("Wind_turbine_name"):
        g = g.reset_index(drop=True)
        run_id = (g["flag"] != g["flag"].shift()).cumsum()
        gap = g["t"].diff().dt.total_seconds().fillna(600) > 600
        run_id = run_id + gap.cumsum()
        for _, r in g[g["flag"]].groupby(run_id[g["flag"]]):
            if len(r) < 3:  # sustained for >= 30 minutes
                continue
            exp_mwh = float(r["expected"].sum() / 6 / 1000)
            obs_mwh = float(r["P_avg"].clip(lower=0).sum() / 6 / 1000)
            events.append({
                "turbine": tid, "start": r["t"].iloc[0].isoformat(),
                "end": (r["t"].iloc[-1] + pd.Timedelta(minutes=10)).isoformat(),
                "durationH": round(len(r) / 6, 2), "meanWs": round(float(r["Ws_avg"].mean()), 2),
                "meanPowerKw": round(float(r["P_avg"].mean()), 1),
                "expectedPowerKw": round(float(r["expected"].mean()), 1),
                "deficitMWh": round(exp_mwh - obs_mwh, 3),
                "meanPitch": round(float(r["Ba_avg"].mean()), 2) if r["Ba_avg"].notna().any() else None,
                "severity": "high" if len(r) >= 36 else ("medium" if len(r) >= 12 else "low"),
            })
    events.sort(key=lambda e: e["deficitMWh"], reverse=True)
    write("anomalies.json", {
        "provenance": {"kind": "predicted",
                       "method": "Power-curve residual exceedance: P_avg below the 5% training quantile of the fleet curve "
                                 "AND >100 kW below expected, wind 4-20 m/s, sustained >= 3 consecutive 10-min records.",
                       "generatedAt": GENERATED_AT},
        "flaggedRecordShare": round(float(allv["flag"].mean()), 4),
        "events": events,
    })

    # ---- Forecast baselines (farm hourly) ---------------------------------
    farm = df.set_index("t").groupby("Wind_turbine_name")["P_avg"].resample("h").mean().unstack(0)
    farm_total = farm.sum(axis=1, min_count=4)  # require all 4 turbines
    farm_total = farm_total[farm_total.index >= pd.Timestamp("2017-01-01T00:00:00Z")]
    tr = farm_total[farm_total.index < SPLIT_UTC]
    te = farm_total[farm_total.index >= SPLIT_UTC]
    clim = tr.groupby(tr.index.hour).mean()
    horizons = [1, 3, 6, 12, 24]
    fc_rows = []
    for h in horizons:
        pers = farm_total.shift(h)[te.index]
        cl = pd.Series(clim.reindex(te.index.hour).to_numpy(), index=te.index)
        fc_rows.append({"horizonH": h, "persistence": metrics(te, pers), "climatology": metrics(te, cl)})
    win = te[(te.index >= pd.Timestamp("2017-12-01T00:00:00Z")) & (te.index < pd.Timestamp("2017-12-15T00:00:00Z"))]
    write("forecast.json", {
        "provenance": {"kind": "predicted",
                       "method": "Naive baselines on 4-turbine farm hourly power (all four turbines present). "
                                 "Persistence: P(t+h)=P(t). Climatology: training-period hour-of-day mean.",
                       "generatedAt": GENERATED_AT},
        "split": {"trainEnd": SPLIT_UTC.isoformat(), "testHours": int(te.notna().sum())},
        "horizons": fc_rows,
        "window": {"t": [x.isoformat() for x in win.index], "observed": rnd(win, 1),
                   "persistence6h": rnd(farm_total.shift(6)[win.index], 1),
                   "climatology": rnd(clim.reindex(win.index.hour).to_numpy(), 1)},
    })


# --------------------------------------------------------------------------
# Hydro (ADCP current profiles, MHKDR submission 648)
# --------------------------------------------------------------------------

LABELS = ["below 0.75 m/s", "monotonic", "non-monotonic (concave)", "non-monotonic (convex)",
          "non-monotonic (mix-concavity)", "pseudo-depth-uniform"]


def build_hydro() -> None:
    print("Hydro NetCDF ...")
    sites = []
    series = {}
    for path in sorted(HYDRO_DIR.glob("*.nc")):
        code = path.stem
        with xr.open_dataset(path) as ds:
            title = str(ds.attrs.get("title", code))
            name = title.replace("Processed data for ", "").split(" (Abbreviated")[0]
            prof = ds["principal_profile"].values.astype("float64")  # (bin, time)
            t = pd.to_datetime(ds["time"].values, utc=True)
            depth = ds["depth"].values.astype("float64")
            bins = ds["bin_height"].values.astype("float64")
            label = ds["label"].values.astype("float64")
            alpha = ds["alpha"].values.astype("float64")
            u = np.nanmean(prof, axis=0)  # depth-averaged over measured bins
            speed = np.abs(u)
            pd_wm2 = 0.5 * RHO_SEA * speed ** 3
            hist_edges = np.arange(0, 4.01, 0.1)
            hist, _ = np.histogram(np.clip(speed, 0, 3.999), hist_edges)
            flood = u > 0
            lab_counts = [int(np.sum(label == k)) for k in range(6)]
            mean_flood = np.nanmean(np.where(flood, prof, np.nan), axis=1)
            mean_ebb = np.nanmean(np.where(~flood, prof, np.nan), axis=1)
            step = max(1, len(t) // 2500)
            dt_s = float(np.median(np.diff(t.asi8)) / 1e9) if len(t) > 1 else None
            sites.append({
                "code": code, "name": name,
                "lat": round(float(ds["lat"]), 4), "lon": round(float(ds["lon"]), 4),
                "start": t[0].isoformat(), "end": t[-1].isoformat(), "records": int(len(t)),
                "medianStepS": round(dt_s, 1) if dt_s else None,
                "meanDepthM": round(float(np.nanmean(depth)), 2),
                "binHeightsM": rnd(bins, 2),
                "speed": {"mean": round(float(np.nanmean(speed)), 3), "p50": round(float(np.nanpercentile(speed, 50)), 3),
                          "p90": round(float(np.nanpercentile(speed, 90)), 3), "max": round(float(np.nanmax(speed)), 3)},
                "floodShare": round(float(np.mean(flood)), 4),
                "aboveCutInShare": round(float(np.mean(speed >= HYDRO_CUT_IN)), 4),
                "meanPowerDensityWm2": round(float(np.nanmean(pd_wm2)), 1),
                "meanAlpha": round(float(np.nanmedian(alpha)), 3) if np.isfinite(alpha).any() else None,
                "labelCounts": lab_counts,
                "speedHist": {"edges": rnd(hist_edges, 2), "counts": hist.tolist()},
                "meanProfileFlood": rnd(mean_flood, 3), "meanProfileEbb": rnd(mean_ebb, 3),
                "source": str(ds.attrs.get("source", "")),
            })
            ts = t[::step]
            series[code] = {"t0": ts[0].isoformat(),
                            "dtS": [int(v) for v in (ts.asi8 - ts.asi8[0]) // 1_000_000_000],
                            "u": rnd(u[::step], 3), "depth": rnd(depth[::step], 2), "stride": step}
    write("hydro_sites.json", {
        "provenance": {"kind": "observed",
                       "source": rel(HYDRO_DIR) + "/*.nc",
                       "method": "Processed ADCP current profiles (Jang et al.). Depth-averaged velocity = mean of "
                                 "principal_profile over measured bins (+ flood, - ebb). Power density 0.5*rho*|u|^3 "
                                 f"with rho={RHO_SEA} kg/m3 is physics-derived, not measured generation.",
                       "generatedAt": GENERATED_AT},
        "labels": LABELS, "rhoSea": RHO_SEA, "cutInMs": HYDRO_CUT_IN,
        "sites": sites,
    })
    write("hydro_series.json", {"provenance": {"kind": "observed", "method": "Decimated to <=2500 points per site."},
                                "series": series})


# --------------------------------------------------------------------------
# Electrolyzer experiments
# --------------------------------------------------------------------------

def build_electrolyzer() -> None:
    print("Electrolyzer experiments ...")
    frames = []
    sources = [
        (ELEC_WIND_CSV, "Wind Turbine Power (kW)", "H2E_n_PSU_A_Power", "IVAL_f_FM011_Flow",
         "wind-emulation", "Profile from IEA 3.4 MW reference turbine at 5/7/9 m/s (per experiment name)"),
        (ELEC_HIST_CSV, "GE 1.5 MW Wind Turbine Power (kW)", "H2E_n_PSU_A_Power (kW)", "IVAL_f_FM011_Flow (kg/hr)",
         "historical-wind", "Profile from GE 1.5 MW turbine power record (per column name)"),
        (TIDAL_CSV, "tidal-500kW-RM1 (kW)", "H2E_n_PSU_A_Power (kW)", "IVAL_f_FM011_Flow (kg/hr)",
         "simulated-tidal", "SIMULATED tidal power profile (RM1 500 kW reference, per file/column name)"),
    ]
    experiments = []
    samples = {}
    for path, src_col, psu_col, flow_col, group, note in sources:
        d = pd.read_csv(path, low_memory=False)
        d = d.rename(columns={src_col: "src", psu_col: "psu", flow_col: "flow"})
        d = d[["Experiment", "src", "psu", "flow", "Efficiency (kWh/kg)"]].copy()
        d["group"] = group
        frames.append(d)
        for exp, g in d.groupby("Experiment", sort=True):
            g = g.dropna(subset=["psu", "flow"])
            kwh = g["psu"].sum()  # samples are ~1 s; ratio of sums is unit-consistent
            kg = g["flow"].sum()
            experiments.append({
                "id": exp, "group": group, "sourceNote": note, "file": rel(path), "rows": int(len(g)),
                "meanSourceKw": round(float(g["src"].mean()), 1) if g["src"].notna().any() else None,
                "meanStackKw": round(float(g["psu"].mean()), 1), "maxStackKw": round(float(g["psu"].max()), 1),
                "meanFlowKgH": round(float(g["flow"].mean()), 3),
                "secKwhPerKg": round(float(kwh / kg), 2) if kg > 0 else None,
            })
            step = max(1, len(g) // 600)
            gs = g.iloc[::step]
            samples[exp] = {"src": rnd(gs["src"], 1), "psu": rnd(gs["psu"], 1), "flow": rnd(gs["flow"], 3),
                            "strideRows": step}

    allx = pd.concat(frames, ignore_index=True).dropna(subset=["psu", "flow"])
    allx = allx[(allx["flow"] > 0) & (allx["psu"] > 0)]
    edges = np.arange(50, 1350, 50)
    b = np.digitize(allx["psu"], edges) - 1
    curve = allx.groupby(b).agg(psu=("psu", "mean"), flow=("flow", "median"), n=("flow", "size"))
    curve = curve[(curve.index >= 0) & (curve.index < len(edges) - 1) & (curve["n"] >= 50)]
    fit = allx[allx["psu"] >= 150]
    slope, intercept = np.polyfit(fit["psu"], fit["flow"], 1)
    pred = slope * fit["psu"] + intercept
    fit_metrics = metrics(fit["flow"], pred)

    write("electrolyzer.json", {
        "provenance": {"kind": "observed",
                       "method": "Measured PEM electrolyzer stack power (PSU) and H2 mass flow (FM011, kg/h) during "
                                 "test-stand experiments that followed wind or SIMULATED tidal power profiles. "
                                 "The hydro-electrolyzer README in the repository is a copy of the ADCP README and does "
                                 "not document these experiments.",
                       "generatedAt": GENERATED_AT},
        "experiments": experiments,
        "stackCurve": {"provenance": "processed",
                       "stackKw": rnd(curve["psu"], 1), "flowKgH": rnd(curve["flow"], 3),
                       "count": curve["n"].astype(int).tolist()},
        "linearFit": {"slopeKgHPerKw": round(float(slope), 6), "interceptKgH": round(float(intercept), 4),
                      "validFromKw": 150, "metrics": fit_metrics},
        "observedRangeKw": {"min": round(float(allx["psu"].quantile(0.001)), 1),
                            "max": round(float(allx["psu"].max()), 1)},
        "overallSecKwhPerKg": round(float(allx["psu"].sum() / allx["flow"].sum()), 2),
        "samples": samples,
    })


def build_manifest() -> None:
    def size(p: Path) -> int:
        return p.stat().st_size if p.exists() else 0

    datasets = [
        {"id": "wind-scada", "name": "La Haute Borne wind SCADA", "path": rel(WIND_CSV), "bytes": size(WIND_CSV),
         "kind": "observed", "format": "CSV (;)",
         "notes": "4 turbines (R80711, R80721, R80736, R80790), 10-min records. Despite the file name the "
                  "records span 2017-01-01 to 2018-01-12."},
        {"id": "electrolyzer-wind", "name": "Electrolyzer wind-profile experiments", "path": rel(ELEC_WIND_CSV),
         "bytes": size(ELEC_WIND_CSV), "kind": "observed", "format": "CSV",
         "notes": "Measured electrolyzer response to IEA 3.4 MW wind power profiles; includes a characterization run."},
        {"id": "electrolyzer-historical", "name": "Electrolyzer historical-wind experiments",
         "path": rel(ELEC_HIST_CSV), "bytes": size(ELEC_HIST_CSV), "kind": "observed", "format": "CSV",
         "notes": "Measured electrolyzer response to a GE 1.5 MW turbine power profile."},
        {"id": "electrolyzer-tidal", "name": "Electrolyzer simulated-tidal experiments", "path": rel(TIDAL_CSV),
         "bytes": size(TIDAL_CSV), "kind": "simulated", "format": "CSV",
         "notes": "Tidal power input is SIMULATED (per file name). Electrolyzer channels are test-stand measurements. "
                  "Never presented as observed tidal generation."},
        {"id": "hydro-adcp", "name": "Tidal current ADCP profiles (14 sites)", "path": rel(HYDRO_DIR),
         "bytes": sum(size(p) for p in HYDRO_DIR.glob("*.nc")), "kind": "observed", "format": "NetCDF",
         "notes": "Processed current depth profiles; no turbine power measurements."},
    ]
    write("manifest.json", {"generatedAt": GENERATED_AT, "generator": "scripts/build_frontend_data.py",
                            "datasets": datasets})


if __name__ == "__main__":
    build_manifest()
    build_hydro()
    build_electrolyzer()
    build_wind()
    print("Done.")
