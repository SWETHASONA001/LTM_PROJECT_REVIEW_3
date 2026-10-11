"""FLORIS integration (physics-derived wake simulation).

FLORIS is optional: when it is not installed every FLORIS endpoint returns
HTTP 503 with an explanation instead of a fabricated result.
"""

from __future__ import annotations

from typing import Any

try:  # pragma: no cover - availability depends on the environment
    import floris  # type: ignore
    from floris import FlorisModel  # type: ignore

    FLORIS_VERSION: str | None = getattr(floris, "__version__", "unknown")
except Exception:  # noqa: BLE001
    FlorisModel = None  # type: ignore
    FLORIS_VERSION = None


def available() -> bool:
    return FlorisModel is not None


def _turbine_definition(t: dict[str, Any]) -> dict[str, Any]:
    """FLORIS v4 turbine dict built from the frontend's power/Ct curve."""
    return {
        "turbine_type": "aerohydro_custom",
        "hub_height": float(t["hub_height"]),
        "rotor_diameter": float(t["rotor_diameter"]),
        "TSR": 8.0,
        "power_thrust_table": {
            "ref_air_density": 1.225,
            "ref_tilt": 5.0,
            "cosine_loss_exponent_yaw": 1.88,
            "cosine_loss_exponent_tilt": 1.88,
            "wind_speed": [float(v) for v in t["ws"]],
            "power": [float(p) for p in t["power_kw"]],  # kW in FLORIS v4
            "thrust_coefficient": [float(c) for c in t["ct"]],
        },
    }


def simulate(req: dict[str, Any]) -> dict[str, Any]:
    if FlorisModel is None:
        raise RuntimeError("FLORIS is not installed on this backend.")
    fmodel = FlorisModel("defaults")
    turbine = _turbine_definition(req["turbine"])
    n = len(req["x"])
    fmodel.set(
        layout_x=[float(v) for v in req["x"]],
        layout_y=[float(v) for v in req["y"]],
        wind_directions=[float(req["wind_direction"])],
        wind_speeds=[float(req["wind_speed"])],
        turbulence_intensities=[float(req["turbulence_intensity"])],
        turbine_type=[turbine] * n,
        reference_wind_height=float(req["turbine"]["hub_height"]),
    )
    fmodel.run()
    powers_w = fmodel.get_turbine_powers()[0]
    velocities = fmodel.core.flow_field.u.mean(axis=(2, 3))[0]
    return {
        "engine": f"FLORIS {FLORIS_VERSION} ({fmodel.core.wake.model_strings.get('velocity_model', 'default')} velocity model)",
        "turbine_power_kw": [float(p) / 1000.0 for p in powers_w],
        "turbine_ws": [float(v) for v in velocities],
        "farm_power_kw": float(powers_w.sum()) / 1000.0,
        "provenance": "physics",
    }
