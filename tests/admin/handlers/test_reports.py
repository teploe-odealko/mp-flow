from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient) -> str:
    resp = client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def test_dds_report(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.get("/v1/admin/reports/dds")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "rows" in data
    assert "by_category" in data
    assert "totals" in data
    assert "date_from" in data
    assert "date_to" in data


def test_pnl_report(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.get("/v1/admin/reports/pnl")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "rows" in data
    assert "totals" in data
    assert "group_by" in data
    assert data["group_by"] == "day"


def test_pnl_report_grouped_by_month(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.get("/v1/admin/reports/pnl", params={"group_by": "month"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["group_by"] == "month"


def test_reports_require_auth(admin_client: TestClient) -> None:
    resp = admin_client.get("/v1/admin/reports/dds")
    assert resp.status_code == 401
