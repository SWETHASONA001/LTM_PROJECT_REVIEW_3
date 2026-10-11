"""Train and evaluate the CNN-PINN and its no-physics ablation.

    backend/.venv/Scripts/python ml/train_cnn_pinn.py

Writes models/cnn_pinn.pt, models/cnn_datadriven.pt and the "cnnPinn" section of
frontend/public/data/ml_models.json.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cnn_pinn import CHANNELS, WINDOW, CNNPINN, Normaliser, predict_kw, steady_window  # noqa: E402
from common import (  # noqa: E402
    MODEL_DIR, SPLIT, TURBINES, VAL_START, air_density, apply_bins, betz_power_kw, conformal_bins,
    load_scada, metrics, now_iso, rated_kw, rnd, update_report,
)

torch.manual_seed(0)
np.random.seed(0)
torch.set_num_threads(max(1, torch.get_num_threads()))

LAMBDA = {"cap": 20.0, "mono": 2.0, "cutin": 2.0}
CUT_IN = 2.5
MONO_RANGE = (3.0, 11.0)


def physics_terms(model, xn, ws_raw, ot_raw, ws_std_scale, rated):
    """Physics residuals on normalised inputs xn (requires_grad) with raw current wind/temperature."""
    xn = xn.clone().requires_grad_(True)
    out = model(xn)
    cap = torch.minimum(torch.as_tensor(betz_power_kw(ws_raw, air_density(ot_raw)) / rated, dtype=torch.float32), torch.tensor(1.0))
    l_cap = torch.relu(out - cap - 0.01).pow(2).mean()
    grad = torch.autograd.grad(out.sum(), xn, create_graph=True)[0][:, 0, -1] / ws_std_scale  # d(out)/d(Ws_now)
    mono_mask = torch.as_tensor((ws_raw >= MONO_RANGE[0]) & (ws_raw <= MONO_RANGE[1]))
    l_mono = (torch.relu(-grad) ** 2 * mono_mask).sum() / mono_mask.sum().clamp(min=1)
    cut_mask = torch.as_tensor(ws_raw < CUT_IN)
    l_cut = ((out.clamp(min=0) ** 2) * cut_mask).sum() / cut_mask.sum().clamp(min=1)
    return l_cap, l_mono, l_cut


def collocation(batch_raw: np.ndarray) -> np.ndarray:
    """Synthetic steady-wind windows spanning 0–25 m/s (outside the data where wind is rare)."""
    n = batch_raw.shape[0]
    ws = np.random.uniform(0, 25, n).astype("float32")
    x = batch_raw.copy()
    x[:, 0, :] = ws[:, None]
    x[:, 1, :] = (0.1 * ws)[:, None]
    return x


def train(name, Xtr, ytr, Xval, yval, norm, rated, physics: bool, epochs=40, batch=2048, patience=5):
    model = CNNPINN()
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, factor=0.5, patience=2)
    Xtr_n = torch.from_numpy(norm(Xtr))
    ytr_t = torch.from_numpy(ytr / rated)
    Xval_n = torch.from_numpy(norm(Xval))
    yval_t = torch.from_numpy(yval / rated)
    ws_scale = float(norm.std[0])
    best = (np.inf, None, 0)
    history = []
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(len(Xtr_n))
        t0 = time.time()
        tot = {"data": 0.0, "cap": 0.0, "mono": 0.0, "cutin": 0.0}
        nb = 0
        for i in range(0, len(perm), batch):
            idx = perm[i : i + batch]
            xb, yb = Xtr_n[idx], ytr_t[idx]
            loss_data = torch.mean((model(xb) - yb) ** 2)
            loss = loss_data
            if physics:
                raw = Xtr[idx.numpy()]
                col = collocation(raw)
                both = np.concatenate([raw, col])
                c, m, cu = physics_terms(model, torch.from_numpy(norm(both)), both[:, 0, -1], both[:, 4, -1], ws_scale, rated)
                loss = loss + LAMBDA["cap"] * c + LAMBDA["mono"] * m + LAMBDA["cutin"] * cu
                tot["cap"] += c.item()
                tot["mono"] += m.item()
                tot["cutin"] += cu.item()
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot["data"] += loss_data.item()
            nb += 1
        model.eval()
        with torch.no_grad():
            val = float(torch.mean((model(Xval_n) - yval_t) ** 2))
        sched.step(val)
        history.append({"epoch": ep + 1, "trainMse": round(tot["data"] / nb, 6), "valMse": round(val, 6), **({k: round(v / nb, 7) for k, v in tot.items() if k != "data"} if physics else {})})
        print(f"  [{name}] epoch {ep + 1:2d} train {tot['data'] / nb:.5f} val {val:.5f} ({time.time() - t0:.1f}s)")
        if val < best[0] - 1e-6:
            best = (val, {k: v.clone() for k, v in model.state_dict().items()}, 0)
        else:
            best = (best[0], best[1], best[2] + 1)
            if best[2] >= patience:
                break
    model.load_state_dict(best[1])
    model.eval()
    return model, history


def physics_audit(model, ckpt, rated):
    """Sweep steady conditions across 0–25 m/s and directions/temperatures; count physics violations."""
    ws = np.arange(0, 25.01, 0.25)
    rows = []
    viol_cap = viol_mono = viol_cut = total = 0
    curves = {}
    for temp in [-5.0, 10.0, 30.0]:
        for wa in [0.0, 90.0, 180.0, 270.0]:
            X = np.concatenate([steady_window(v, wa, 0.1 * v, temp) for v in ws])
            p = predict_kw(model, ckpt, X)
            cap = np.minimum(betz_power_kw(ws, air_density(temp)), rated)
            viol_cap += int(np.sum(p > cap + 0.01 * rated))
            below = (ws >= 3) & (ws <= 11)
            d = np.diff(p)
            viol_mono += int(np.sum((d < -0.01 * rated) & below[1:]))
            viol_cut += int(np.sum((p > 0.02 * rated) & (ws < 2.0)))
            total += len(ws)
            if temp == 10.0 and wa == 180.0:
                curves = {"ws": rnd(ws, 2), "p": rnd(p, 1), "cap": rnd(cap, 1)}
    rows.append({"capViolations": viol_cap, "monotonicViolations": viol_mono, "cutInViolations": viol_cut, "points": total})
    return rows[0], curves


def main():
    t_start = time.time()
    print("Loading SCADA …")
    df = load_scada()
    rated = rated_kw(df)
    parts = {"train": [], "val": [], "test": []}
    for tid in TURBINES:
        w = __import__("cnn_pinn").build_windows(df[df["Wind_turbine_name"] == tid])
        X, y, t = w
        tid_arr = np.full(len(y), tid)
        for key, mask in {"train": t < VAL_START, "val": (t >= VAL_START) & (t < SPLIT), "test": t >= SPLIT}.items():
            parts[key].append((X[mask], y[mask], t[mask], tid_arr[mask]))
    cat = {k: (np.concatenate([p[0] for p in v]), np.concatenate([p[1] for p in v]), np.concatenate([np.asarray(p[2]) for p in v]), np.concatenate([p[3] for p in v])) for k, v in parts.items()}
    Xtr, ytr, _, _ = cat["train"]
    Xval, yval, _, _ = cat["val"]
    Xte, yte, tte, idte = cat["test"]
    print(f"  windows: train {len(ytr):,} · val {len(yval):,} · test {len(yte):,}")
    flat = Xtr.transpose(0, 2, 1).reshape(-1, Xtr.shape[1])
    norm = Normaliser(flat.mean(axis=0), flat.std(axis=0))

    results = {}
    edges = np.arange(0, 26, 1.0)
    for name, physics in [("cnn_pinn", True), ("cnn_datadriven", False)]:
        model, hist = train(name, Xtr, ytr, Xval, yval, norm, rated, physics)
        ckpt = {"state_dict": model.state_dict(), "mean": norm.mean.tolist(), "std": norm.std.tolist(), "rated_kw": rated, "window": WINDOW, "channels": CHANNELS}
        pv = predict_kw(model, ckpt, Xval)
        lo, hi = conformal_bins(Xval[:, 0, -1], yval - pv, edges)
        ckpt.update({"conformal_edges": edges.tolist(), "conformal_lo": lo.tolist(), "conformal_hi": hi.tolist(), "trained_at": now_iso(), "physics_loss": physics, "lambda": LAMBDA if physics else None})
        torch.save(ckpt, MODEL_DIR / f"{name}.pt")
        pt = predict_kw(model, ckpt, Xte)
        wte = Xte[:, 0, -1]
        lo_t = pt + apply_bins(wte, edges, lo)
        hi_t = pt + apply_bins(wte, edges, hi)
        cap_te = np.minimum(betz_power_kw(wte, air_density(Xte[:, 4, -1])), rated)
        audit, curve = physics_audit(model, ckpt, rated)
        results[name] = {
            "metrics": metrics(yte, pt),
            "perTurbine": {tid: metrics(yte[idte == tid], pt[idte == tid]) for tid in TURBINES},
            "interval": {"method": "Split-conformal residual quantiles per 1 m/s bin (calibrated on Sep 2017)", "nominal": 0.9, "testCoverage": round(float(np.mean((yte >= lo_t) & (yte <= hi_t))), 4)},
            "testAboveBetzShare": round(float(np.mean(pt > cap_te + 0.01 * rated)), 5),
            "physicsAudit": audit,
            "curve": curve,
            "history": hist,
            "epochs": len(hist),
        }
        sel = (idte == "R80711") & (tte >= pd.Timestamp("2017-11-06", tz="UTC")) & (tte < pd.Timestamp("2017-11-13", tz="UTC"))
        results[name]["testWeek"] = {"t": [pd.Timestamp(x).isoformat() for x in tte[sel]], "observed": rnd(yte[sel], 1), "predicted": rnd(pt[sel], 1), "lo": rnd(lo_t[sel], 1), "hi": rnd(hi_t[sel], 1)}

    p, d = results["cnn_pinn"], results["cnn_datadriven"]
    update_report("cnnPinn", {
        "id": "cnn-pinn",
        "name": "CNN-PINN wind-power model",
        "status": "trained",
        "trainedAt": now_iso(),
        "artifact": "models/cnn_pinn.pt",
        "code": "ml/cnn_pinn.py, ml/train_cnn_pinn.py",
        "architecture": f"Conv1d({len(CHANNELS)}→32,k3)·GELU·Conv1d(32→32,k3)·GELU·Linear(192→64)·GELU·Linear(64→1), bounded output; input = last {WINDOW} ten-minute records",
        "inputs": CHANNELS,
        "physics": [
            "Upper bound: P ≤ min(½·ρ·A·v³·16/27, rated), ρ from outdoor temperature at standard pressure (ideal gas), A from D = 82 m",
            "Monotonicity: ∂P/∂v ≥ 0 for 3–11 m/s (autograd on the input wind speed)",
            "Cut-in: P ≈ 0 below 2.5 m/s",
            "Residuals evaluated on training data and on synthetic steady-wind collocation windows spanning 0–25 m/s",
        ],
        "lambda": LAMBDA,
        "split": {"train": f"< {VAL_START.date()}", "validation": f"{VAL_START.date()} – {SPLIT.date()} (early stopping, conformal calibration)", "test": f">= {SPLIT.date()}", "trainWindows": int(len(ytr)), "valWindows": int(len(yval)), "testWindows": int(len(yte))},
        "pinn": p,
        "ablation": d,
        "trainingSeconds": round(time.time() - t_start, 1),
    })


if __name__ == "__main__":
    main()
