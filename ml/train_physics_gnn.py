"""Dynamic Physics-GNN for turbine interaction (4 La Haute Borne turbines).

Nodes are the four turbines at synchronised 10-minute timestamps. Because the
repository has no turbine coordinates, the graph is not built from geometry:
edge weights a_ij(θ) are learned as a function of the farm wind direction θ
(a direction-dependent, i.e. dynamic, adjacency). The learned adjacency is
exported so engineers can inspect which turbines influence which, per sector.

Physics: the same Betz/rated upper bound, monotonicity (∂P_i/∂v_i ≥ 0 below
rated) and cut-in residuals as the CNN-PINN, applied per node. An ablation with
the message passing disabled (a_ij = 0) quantifies what the interaction adds.

    backend/.venv/Scripts/python ml/train_physics_gnn.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    MODEL_DIR, SPLIT, TURBINES, VAL_START, air_density, betz_power_kw, load_scada, metrics, now_iso, rated_kw, rnd, update_report,
)

torch.manual_seed(0)
np.random.seed(0)
N = len(TURBINES)
FEATS = ["Ws_avg", "Ws_std", "Ot_avg"]  # per node; direction enters through the adjacency and node embedding
LAMBDA = {"cap": 20.0, "mono": 2.0, "cutin": 2.0}


class PhysicsGNN(nn.Module):
    def __init__(self, hidden=32, message_passing=True):
        super().__init__()
        self.mp = message_passing
        self.node_emb = nn.Embedding(N, 8)
        self.enc = nn.Sequential(nn.Linear(len(FEATS) + 2 + 8, hidden), nn.GELU(), nn.Linear(hidden, hidden), nn.GELU())
        # Edge weights from [sinθ, cosθ, emb_i, emb_j]
        self.edge = nn.Sequential(nn.Linear(2 + 16, 32), nn.GELU(), nn.Linear(32, 1))
        self.msg = nn.Linear(hidden, hidden)
        self.dec = nn.Sequential(nn.Linear(2 * hidden, hidden), nn.GELU(), nn.Linear(hidden, 1))

    def adjacency(self, dir_sc):  # dir_sc: (B, 2) -> (B, N, N)
        B = dir_sc.shape[0]
        e = self.node_emb.weight
        ei = e[:, None, :].expand(N, N, 8)
        ej = e[None, :, :].expand(N, N, 8)
        pair = torch.cat([ei, ej], dim=-1)[None].expand(B, N, N, 16)
        d = dir_sc[:, None, None, :].expand(B, N, N, 2)
        a = torch.sigmoid(self.edge(torch.cat([d, pair], dim=-1)).squeeze(-1))
        return a * (1 - torch.eye(N))[None]

    def forward(self, x, dir_sc):  # x: (B, N, F) normalised
        B = x.shape[0]
        emb = self.node_emb.weight[None].expand(B, N, 8)
        h = self.enc(torch.cat([x, dir_sc[:, None, :].expand(B, N, 2), emb], dim=-1))
        if self.mp:
            a = self.adjacency(dir_sc)
            m = torch.bmm(a, self.msg(h)) / (N - 1)
        else:
            m = torch.zeros_like(h)
        return 1.06 * torch.sigmoid(self.dec(torch.cat([h, m], dim=-1)).squeeze(-1)) - 0.02  # (B, N) rated units


def synchronised(df):
    index = pd.DatetimeIndex(sorted(df["t"].unique()))
    wide = {}
    for f in ["P_avg", *FEATS, "Wa_avg"]:
        wide[f] = df.pivot(index="t", columns="Wind_turbine_name", values=f).reindex(index)[TURBINES]
    ok = np.ones(len(wide["P_avg"]), bool)
    for v in wide.values():
        ok &= v.notna().all(axis=1).to_numpy()
    t = wide["P_avg"].index[ok]
    X = np.stack([wide[f].to_numpy()[ok] for f in FEATS], axis=-1).astype("float32")  # (T, N, F)
    rad = np.deg2rad(wide["Wa_avg"].to_numpy()[ok])
    dir_sc = np.stack([np.sin(rad).mean(axis=1), np.cos(rad).mean(axis=1)], axis=-1)
    dir_sc /= np.linalg.norm(dir_sc, axis=1, keepdims=True) + 1e-9
    y = wide["P_avg"].to_numpy()[ok].astype("float32")
    return t, X, dir_sc.astype("float32"), y


def train(name, mp, data, norm, rated, epochs=40, batch=1024, patience=5):
    (Xtr, Dtr, ytr), (Xval, Dval, yval) = data
    mean, std = norm
    model = PhysicsGNN(message_passing=mp)
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    Xtr_n = torch.from_numpy((Xtr - mean) / std)
    Xval_n = torch.from_numpy((Xval - mean) / std)
    best = (np.inf, None, 0)
    hist = []
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(len(Xtr_n))
        tot = nb = 0.0
        for i in range(0, len(perm), batch):
            idx = perm[i : i + batch]
            xb = Xtr_n[idx].clone().requires_grad_(True)
            db = torch.from_numpy(Dtr[idx.numpy()])
            out = model(xb, db)
            loss_data = torch.mean((out - torch.from_numpy(ytr[idx.numpy()] / rated)) ** 2)
            ws = Xtr[idx.numpy(), :, 0]
            cap = torch.from_numpy(np.minimum(betz_power_kw(ws, air_density(Xtr[idx.numpy(), :, 2])) / rated, 1.0).astype("float32"))
            l_cap = torch.relu(out - cap - 0.01).pow(2).mean()
            g = torch.autograd.grad(out.sum(), xb, create_graph=True)[0][..., 0] / float(std[0])
            mono = torch.from_numpy(((ws >= 3) & (ws <= 11)).astype("float32"))
            l_mono = (torch.relu(-g) ** 2 * mono).sum() / mono.sum().clamp(min=1)
            cut = torch.from_numpy((ws < 2.5).astype("float32"))
            l_cut = (out.clamp(min=0) ** 2 * cut).sum() / cut.sum().clamp(min=1)
            loss = loss_data + LAMBDA["cap"] * l_cap + LAMBDA["mono"] * l_mono + LAMBDA["cutin"] * l_cut
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += loss_data.item()
            nb += 1
        model.eval()
        with torch.no_grad():
            val = float(torch.mean((model(Xval_n, torch.from_numpy(Dval)) - torch.from_numpy(yval / rated)) ** 2))
        hist.append({"epoch": ep + 1, "trainMse": round(tot / nb, 6), "valMse": round(val, 6)})
        print(f"  [{name}] epoch {ep + 1:2d} train {tot / nb:.5f} val {val:.5f}")
        if val < best[0] - 1e-6:
            best = (val, {k: v.clone() for k, v in model.state_dict().items()}, 0)
        else:
            best = (best[0], best[1], best[2] + 1)
            if best[2] >= patience:
                break
    model.load_state_dict(best[1])
    model.eval()
    return model, hist


def main():
    t0 = time.time()
    df = load_scada()
    rated = rated_kw(df)
    t, X, D, y = synchronised(df)
    tr = t < VAL_START
    va = (t >= VAL_START) & (t < SPLIT)
    te = t >= SPLIT
    print(f"  synchronised samples: train {tr.sum():,} · val {va.sum():,} · test {te.sum():,}")
    flat = X[tr].reshape(-1, X.shape[-1])
    mean, std = flat.mean(axis=0), flat.std(axis=0)
    data = ((X[tr], D[tr], y[tr]), (X[va], D[va], y[va]))
    out = {}
    for name, mp in [("physics_gnn", True), ("gnn_no_message_passing", False)]:
        model, hist = train(name, mp, data, (mean, std), rated)
        with torch.no_grad():
            pred = model(torch.from_numpy((X[te] - mean) / std), torch.from_numpy(D[te])).numpy() * rated
        torch.save({"state_dict": model.state_dict(), "mean": mean.tolist(), "std": std.tolist(), "rated_kw": rated, "turbines": TURBINES, "features": FEATS, "message_passing": mp, "trained_at": now_iso()}, MODEL_DIR / f"{name}.pt")
        out[name] = {
            "metrics": metrics(y[te].ravel(), pred.ravel()),
            "perTurbine": {tid: metrics(y[te][:, i], pred[:, i]) for i, tid in enumerate(TURBINES)},
            "epochs": len(hist),
            "history": hist,
        }
        if mp:
            sectors = np.arange(0, 360, 30)
            th = np.deg2rad(sectors)
            with torch.no_grad():
                A = model.adjacency(torch.tensor(np.stack([np.sin(th), np.cos(th)], -1), dtype=torch.float32)).numpy()
            out[name]["adjacency"] = {"sectors": sectors.tolist(), "turbines": TURBINES, "weights": [[rnd(row, 3) for row in A[k]] for k in range(len(sectors))]}
    update_report("physicsGnn", {
        "id": "physics-gnn",
        "name": "Dynamic Physics-GNN turbine interaction",
        "status": "trained",
        "trainedAt": now_iso(),
        "artifact": "models/physics_gnn.pt",
        "code": "ml/train_physics_gnn.py",
        "graph": "4 turbine nodes; edge weights a_ij(θ) learned from farm wind direction (no coordinates available)",
        "nodeFeatures": FEATS,
        "physics": ["Per-node Betz/rated upper bound with temperature-derived density", "∂P_i/∂v_i ≥ 0 for 3–11 m/s", "P ≈ 0 below 2.5 m/s"],
        "lambda": LAMBDA,
        "split": {"trainSamples": int(tr.sum()), "valSamples": int(va.sum()), "testSamples": int(te.sum()), "note": "Only timestamps where all four turbines have valid data"},
        "gnn": out["physics_gnn"],
        "ablation": out["gnn_no_message_passing"],
        "trainingSeconds": round(time.time() - t0, 1),
    })


if __name__ == "__main__":
    main()
