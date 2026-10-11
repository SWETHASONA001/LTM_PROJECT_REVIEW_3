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


def test_unimplemented_endpoints_are_explicit(client):
    assert client.post("/api/optimize").status_code == 501
    assert client.post("/api/forecast").status_code == 501
    r = client.post("/api/copilot/chat", json={"conversation_id": "c", "message": "hi"})
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]


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
