import pytest
from fastapi.testclient import TestClient

from app import config, floris_service
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "STORAGE_DIR", tmp_path)
    return TestClient(app)


def test_health_reports_capabilities(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    caps = r.json()["capabilities"]
    assert caps["floris"] == floris_service.available()
    assert caps["llm"] is False


def test_wind_hourly_slice(client):
    r = client.get("/api/wind/hourly", params={"turbine": "R80711", "start": 0, "hours": 24, "fields": "P,Ws"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["values"]["P"]) == 24
    assert body["units"]["P"] == "kW"


def test_wind_hourly_unknown_turbine(client):
    assert client.get("/api/wind/hourly", params={"turbine": "X1"}).status_code == 404


def test_layout_validation(client):
    body = {
        "turbines": [{"id": "a", "x": 0, "y": 0}, {"id": "b", "x": 100, "y": 0}, {"id": "c", "x": 5000, "y": 0}],
        "rotor_diameter": 82,
        "min_spacing_d": 3,
        "boundary_width": 2000,
        "boundary_height": 2000,
    }
    r = client.post("/api/layout/validate", json=body)
    kinds = {v["kind"] for v in r.json()["violations"]}
    assert kinds == {"spacing", "boundary"}


def test_scenario_roundtrip(client):
    r = client.post("/api/scenarios", json={"name": "t", "site": "onshore", "turbines": [{"id": "a", "x": 0, "y": 0}]})
    assert r.status_code == 201
    sid = r.json()["id"]
    assert any(s["id"] == sid for s in client.get("/api/scenarios").json())
    assert client.delete(f"/api/scenarios/{sid}").status_code == 204
    assert client.delete(f"/api/scenarios/{sid}").status_code == 404


def test_copilot_reports_missing_provider(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    monkeypatch.setattr(config, "LLM_PROVIDER", "")
    r = client.post("/api/copilot/chat", json={"conversation_id": "c", "message": "hi"})
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]


def test_cnn_pinn_predict_respects_physics(client):
    from app import ml_service

    if not ml_service.cnn_status()["available"]:
        assert client.post("/api/models/cnn-pinn/predict", json={"wind_speed": 9}).status_code == 503
        return
    low = client.post("/api/models/cnn-pinn/predict", json={"wind_speed": 1.0}).json()
    mid = client.post("/api/models/cnn-pinn/predict", json={"wind_speed": 9.0}).json()
    assert low["power_kw"] < 50
    assert mid["power_kw"] > low["power_kw"]
    assert mid["power_kw"] <= mid["physics_cap_kw"] * 1.02
    lo, hi = mid["interval_kw"]
    assert lo <= mid["power_kw"] <= hi


def test_forecast_endpoint(client):
    r = client.post("/api/forecast", json={"issue_time": "2017-12-03T06:00:00Z"})
    if r.status_code == 503:
        return
    assert r.status_code == 200, r.text
    f = r.json()["forecasts"]
    assert [x["horizon_h"] for x in f] == [1, 3, 6, 12, 24]
    assert all(x["interval_kw"][0] <= x["forecast_kw"] <= x["interval_kw"][1] for x in f)


def test_hydrogen_dispatch_balance(client):
    body = {
        "available_kw": [0, 50, 300, 1200, 2500, 800, 90, 0, 1500],
        "stack_curve": {"kw": [100, 500, 1000], "kg_per_h": [2.2, 10, 18]},
        "plant": {"modules": 2, "staging": "optimal", "storage_kwh": 2000, "storage_kw": 500, "round_trip_eff": 0.85},
    }
    r = client.post("/api/hydrogen/allocate", json=body).json()
    assert abs(r["balance_error_mwh"]) < 1e-9
    assert r["h2_kg"] > 0
    assert r["to_electrolyzer_mwh"] <= r["available_mwh"] + 1e-9


def test_floris_optimizer_improves_and_respects_constraints(client):
    from app import floris_service

    base = _two_turbines()
    body = {
        "x": [0, 0, 0], "y": [0, -400, -800], "movable": [False, True, True],
        "turbine": base["turbine"],
        "cases": {"dirs": [0, 180, 270], "speeds": [8, 8, 9], "probs": [0.5, 0.3, 0.2]},
        "turbulence_intensity": 0.1, "min_spacing_d": 3, "boundary_width": 2000, "boundary_height": 2000,
        "max_evaluations": 40,
    }
    r = client.post("/api/optimize", json=body)
    if not floris_service.available():
        assert r.status_code == 503
        return
    out = r.json()
    assert out["best_aep_mwh"] >= out["start_aep_mwh"]
    assert out["x"][0] == 0 and out["y"][0] == 0
    assert out["violation_m"] < 1e-6


def _two_turbines():
    ws = [float(v) for v in range(0, 31)]
    power = [0, 0, 0, 50, 150, 300, 500, 750, 1000, 1300, 1600, 1850, 2000] + [2050] * 13 + [0] * 5
    ct = [0, 0, 0, 0.85, 0.82, 0.8, 0.79, 0.78, 0.76, 0.7, 0.6, 0.5, 0.42] + [0.3] * 13 + [0] * 5
    return {
        "site": "onshore",
        "x": [0, 0],
        "y": [0, -410],
        "wind_direction": 0,
        "wind_speed": 8,
        "turbulence_intensity": 0.1,
        "turbine": {"rotor_diameter": 82, "hub_height": 80, "ws": ws, "power_kw": power, "ct": ct},
    }


def test_floris_simulate(client):
    r = client.post("/api/floris/simulate", json=_two_turbines())
    if not floris_service.available():
        assert r.status_code == 503
        return
    assert r.status_code == 200, r.text
    out = r.json()
    p = out["turbine_power_kw"]
    assert len(p) == 2
    # Turbine 2 is directly downstream (wind from north) and must produce less.
    assert p[1] < p[0]
    assert abs(sum(p) - out["farm_power_kw"]) < 1e-6


def test_auth_login_flow(client, tmp_path):
    from app import auth_service

    assert client.post("/api/auth/login", json={"email": "a@b.c", "password": "x"}).status_code == 503
    auth_service.create_user("Eng@Example.com", "Eng One", "correct-horse-battery")
    assert client.post("/api/auth/login", json={"email": "eng@example.com", "password": "wrong-password"}).status_code == 401
    r = client.post("/api/auth/login", json={"email": "eng@example.com", "password": "correct-horse-battery"})
    assert r.status_code == 200
    token = r.json()["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["user"]["name"] == "Eng One"
    tampered = token[:-2] + ("AA" if not token.endswith("AA") else "BB")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {tampered}"}).status_code == 401
