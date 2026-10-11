"""FLORIS-based turbine-placement optimisation (server side).

Same algorithm as the in-browser optimiser (frontend/src/physics/optimizer.ts):
randomised coordinate pattern search with adaptive step, wind-rose-weighted
AEP objective, spacing/boundary as lexicographic hard constraints, locked
turbines never moved — but every AEP evaluation is a FLORIS run.
"""

from __future__ import annotations

import math
import random
import time
from typing import Any

import numpy as np

from . import floris_service


def violation(xs, ys, min_m, hw, hh) -> float:
    total = 0.0
    n = len(xs)
    for i in range(n):
        total += max(abs(xs[i]) - hw, 0) + max(abs(ys[i]) - hh, 0)
        for j in range(i + 1, n):
            d = math.hypot(xs[i] - xs[j], ys[i] - ys[j])
            if d < min_m:
                total += min_m - d
    return total


def optimise(req: dict[str, Any]) -> dict[str, Any]:
    if not floris_service.available():
        raise RuntimeError("FLORIS is not installed on this backend.")
    from floris import FlorisModel  # noqa: PLC0415

    t0 = time.time()
    turbine = floris_service._turbine_definition(req["turbine"])
    dirs = np.asarray(req["cases"]["dirs"], float)
    speeds = np.asarray(req["cases"]["speeds"], float)
    probs = np.asarray(req["cases"]["probs"], float)
    probs = probs / probs.sum()
    ti = float(req["turbulence_intensity"])
    D = float(req["turbine"]["rotor_diameter"])
    min_m = float(req["min_spacing_d"]) * D
    hw, hh = float(req["boundary_width"]) / 2, float(req["boundary_height"]) / 2
    x = [float(v) for v in req["x"]]
    y = [float(v) for v in req["y"]]
    movable = [i for i, m in enumerate(req["movable"]) if m]
    fmodel = FlorisModel("defaults")
    fmodel.set(wind_directions=dirs, wind_speeds=speeds, turbulence_intensities=np.full(len(dirs), ti), reference_wind_height=float(req["turbine"]["hub_height"]))

    def aep(xs, ys) -> float:
        fmodel.set(layout_x=xs, layout_y=ys, turbine_type=[turbine] * len(xs))
        fmodel.run()
        farm_kw = fmodel.get_farm_power() / 1000.0
        return float(np.sum(farm_kw * probs) * 8760 / 1000.0)  # MWh/yr

    rng = random.Random(int(req.get("seed", 7)))
    best = aep(x, y)
    start = best
    viol = violation(x, y, min_m, hw, hh)
    start_viol = viol
    evals, accepted = 1, 0
    history = [{"evaluations": 1, "aep": best}]
    step = float(req.get("initial_step_d", 2.0)) * D
    min_step = float(req.get("min_step_d", 0.1)) * D
    max_evals = int(req.get("max_evaluations", 200))
    terminated = "max-evaluations"
    base_dirs = [(math.cos(k * math.pi / 4), math.sin(k * math.pi / 4)) for k in range(8)]
    while evals < max_evals and movable:
        improved = False
        order = movable[:]
        rng.shuffle(order)
        for i in order:
            if evals >= max_evals:
                break
            rot = rng.random() * 2 * math.pi
            c, s = math.cos(rot), math.sin(rot)
            for dx0, dy0 in base_dirs:
                if evals >= max_evals:
                    break
                ox, oy = x[i], y[i]
                x[i] = ox + (dx0 * c - dy0 * s) * step
                y[i] = oy + (dx0 * s + dy0 * c) * step
                v = violation(x, y, min_m, hw, hh)
                accept = False
                if v < viol - 1e-6:
                    a = aep(x, y)
                    evals += 1
                    accept = True
                elif v <= 1e-6 and viol <= 1e-6:
                    a = aep(x, y)
                    evals += 1
                    accept = a > best + 1e-6
                if accept:
                    best, viol = a, v
                    accepted += 1
                    improved = True
                    history.append({"evaluations": evals, "aep": best})
                    break
                x[i], y[i] = ox, oy
        if not improved:
            step *= 0.5
            if step < min_step:
                terminated = "min-step"
                break
    history.append({"evaluations": evals, "aep": best})
    return {
        "engine": f"FLORIS {floris_service.FLORIS_VERSION}",
        "method": "Randomised coordinate pattern search on FLORIS wind-rose AEP; spacing & boundary as hard lexicographic constraints",
        "x": [round(v) for v in x],
        "y": [round(v) for v in y],
        "start_aep_mwh": start,
        "best_aep_mwh": best,
        "start_violation_m": start_viol,
        "violation_m": viol,
        "evaluations": evals,
        "accepted_moves": accepted,
        "terminated_by": terminated,
        "history": history,
        "seconds": round(time.time() - t0, 2),
        "provenance": "optimized",
    }
