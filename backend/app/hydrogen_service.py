"""PEM electrolyzer + battery dispatch (Python port of frontend/src/physics/hydrogen.ts).

Energy balance per step (no double counting):
    available = direct + charged + curtailed
    to_electrolyzer = direct + discharged
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def _rate(curve_kw, curve_kg, min_kw, max_kw, kw):
    if kw < min_kw - 1e-9:
        return 0.0
    return float(np.interp(min(kw, max_kw), curve_kw, curve_kg))


def stage(curve_kw, curve_kg, min_kw, max_kw, kw, modules, strategy):
    if kw < min_kw or modules <= 0:
        return 0.0, 0.0, 0
    if strategy == "sequential":
        remaining = min(kw, modules * max_kw)
        kg = used = 0.0
        active = 0
        while remaining > 1e-9 and active < modules:
            share = min(remaining, max_kw)
            if share < min_kw:
                break
            kg += _rate(curve_kw, curve_kg, min_kw, max_kw, share)
            used += share
            remaining -= share
            active += 1
        return kg, used, active
    best = (0.0, 0.0, 0)
    for k in range(1, modules + 1):
        share = min(kw / k, max_kw)
        if share < min_kw:
            break
        kg = k * _rate(curve_kw, curve_kg, min_kw, max_kw, share)
        if kg > best[0]:
            best = (kg, share * k, k)
    return best


def dispatch(req: dict[str, Any]) -> dict[str, Any]:
    ck, cg = req["stack_curve"]["kw"], req["stack_curve"]["kg_per_h"]
    min_kw, max_kw = float(ck[0]), float(ck[-1])
    p = req["plant"]
    modules, strategy = int(p["modules"]), p["staging"]
    cap_kwh, cap_kw, rte = float(p["storage_kwh"]), float(p["storage_kw"]), float(p["round_trip_eff"])
    dt = float(req.get("dt_h", 1.0))
    eff = math.sqrt(rte)
    soc = 0.0
    tot = dict(available=0.0, direct=0.0, discharged=0.0, charged=0.0, curtailed=0.0, to_elec=0.0, h2=0.0, hours=0.0)
    cap_plant = modules * max_kw
    for raw in req["available_kw"]:
        P = max(0.0, float(raw) if raw is not None and math.isfinite(raw) else 0.0)
        direct = min(P, cap_plant)
        from_store = 0.0
        if direct < min_kw:
            need = min_kw - direct
            can = min(cap_kw, soc * eff / dt)
            if cap_kwh > 0 and can >= need:
                from_store = need
            else:
                direct = 0.0
        elif direct < cap_plant and cap_kwh > 0:
            from_store = min(cap_plant - direct, cap_kw, soc * eff / dt)
        kg, used, active = stage(ck, cg, min_kw, max_kw, direct + from_store, modules, strategy)
        used_store = min(from_store, used)
        used_direct = used - used_store
        soc -= used_store * dt / eff
        surplus = P - used_direct
        charge = max(0.0, min(surplus, cap_kw, max(0.0, (cap_kwh - soc) / (eff * dt)))) if cap_kwh > 0 else 0.0
        soc += charge * dt * eff
        surplus -= charge
        tot["available"] += P * dt / 1000
        tot["direct"] += used_direct * dt / 1000
        tot["discharged"] += used_store * dt / 1000
        tot["charged"] += charge * dt / 1000
        tot["curtailed"] += surplus * dt / 1000
        tot["to_elec"] += used * dt / 1000
        tot["h2"] += kg * dt
        tot["hours"] += dt if active else 0.0
    final_soc = soc / 1000
    return {
        "available_mwh": tot["available"],
        "to_electrolyzer_mwh": tot["to_elec"],
        "direct_mwh": tot["direct"],
        "charged_mwh": tot["charged"],
        "discharged_mwh": tot["discharged"],
        "curtailed_mwh": tot["curtailed"],
        "storage_loss_mwh": max(0.0, tot["charged"] - tot["discharged"] - final_soc),
        "final_soc_mwh": final_soc,
        "h2_kg": tot["h2"],
        "sec_kwh_per_kg": tot["to_elec"] * 1000 / tot["h2"] if tot["h2"] > 0 else 0.0,
        "operating_hours": tot["hours"],
        "balance_error_mwh": tot["available"] - (tot["direct"] + tot["charged"] + tot["curtailed"]),
        "provenance": "simulated",
    }
