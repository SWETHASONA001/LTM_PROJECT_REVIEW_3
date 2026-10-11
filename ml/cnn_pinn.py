"""CNN-PINN wind-power model: architecture, features and inference.

Input: a window of the last W=6 ten-minute SCADA records (1 hour) with
channels [Ws_avg, Ws_std, sin(Wa), cos(Wa), Ot_avg]. Output: active power at
the last record as a fraction of rated power.

Physics enters through the training loss (see train_cnn_pinn.py), not just
the architecture: predictions are penalised when they exceed the Betz/rated
bound computed from the input wind speed and temperature-derived air density,
when power decreases with wind speed below rated, and when power is produced
below cut-in.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from torch import nn

WINDOW = 6
CHANNELS = ["Ws_avg", "Ws_std", "sin_Wa", "cos_Wa", "Ot_avg"]


class CNNPINN(nn.Module):
    def __init__(self, channels: int = len(CHANNELS), hidden: int = 32):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv1d(channels, hidden, kernel_size=3, padding=1),
            nn.GELU(),
            nn.Conv1d(hidden, hidden, kernel_size=3, padding=1),
            nn.GELU(),
        )
        self.head = nn.Sequential(nn.Linear(hidden * WINDOW, 64), nn.GELU(), nn.Linear(64, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # x: (B, C, W) normalised
        z = self.conv(x).flatten(1)
        # Bounded output in rated-power units (small negative allowed for parasitic load).
        return 1.06 * torch.sigmoid(self.head(z)).squeeze(1) - 0.02


def build_windows(df_turbine, mean=None, std=None):
    """Return (X_raw (N,C,W), y_kw (N,), t (N,), ws_now, ot_now) for consecutive valid windows."""
    import pandas as pd

    g = df_turbine.set_index("t").sort_index()
    full = pd.date_range(g.index.min(), g.index.max(), freq="10min")
    g = g.reindex(full)
    rad = np.deg2rad(g["Wa_avg"].to_numpy())
    feats = np.stack([g["Ws_avg"].to_numpy(), g["Ws_std"].to_numpy(), np.sin(rad), np.cos(rad), g["Ot_avg"].to_numpy()], axis=0)
    y = g["P_avg"].to_numpy()
    n = feats.shape[1] - WINDOW + 1
    if n <= 0:
        return None
    win = np.lib.stride_tricks.sliding_window_view(feats, WINDOW, axis=1)  # (C, n, W)
    win = np.transpose(win, (1, 0, 2))  # (n, C, W)
    target = y[WINDOW - 1 :]
    ok = np.isfinite(win).all(axis=(1, 2)) & np.isfinite(target)
    return win[ok].astype("float32"), target[ok].astype("float32"), full[WINDOW - 1 :][ok]


class Normaliser:
    def __init__(self, mean: np.ndarray, std: np.ndarray):
        self.mean = mean.astype("float32")
        self.std = np.where(std < 1e-6, 1.0, std).astype("float32")

    def __call__(self, x: np.ndarray) -> np.ndarray:
        return (x - self.mean[None, :, None]) / self.std[None, :, None]


def load(path: Path):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    model = CNNPINN()
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    return model, ckpt


def steady_window(ws: float, wa_deg: float, ws_std: float, temp_c: float) -> np.ndarray:
    """A constant-conditions input window (used for the API and power-curve sweeps)."""
    r = np.deg2rad(wa_deg)
    row = np.array([ws, ws_std, np.sin(r), np.cos(r), temp_c], dtype="float32")
    return np.repeat(row[None, :, None], WINDOW, axis=2)


@torch.no_grad()
def predict_kw(model, ckpt, windows_raw: np.ndarray) -> np.ndarray:
    norm = Normaliser(np.array(ckpt["mean"]), np.array(ckpt["std"]))
    x = torch.from_numpy(norm(windows_raw))
    return model(x).numpy() * ckpt["rated_kw"]
