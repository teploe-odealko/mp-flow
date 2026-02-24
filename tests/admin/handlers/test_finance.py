from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient) -> str:
    resp = client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def test_list_finance_transactions(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.get("/v1/admin/finance/transactions")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "items" in data
    assert "total" in data


def test_create_finance_transaction(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.post(
        "/v1/admin/finance/transactions",
        json={
            "kind": "expense",
            "category": "logistics",
            "amount_rub": "1500.00",
            "notes": "Test logistics expense",
        },
    )
    assert resp.status_code == 200, resp.text
    item = resp.json()["item"]
    assert item["kind"] == "expense"
    assert item["category"] == "logistics"


def test_create_finance_invalid_kind(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.post(
        "/v1/admin/finance/transactions",
        json={
            "kind": "invalid",
            "category": "test",
            "amount_rub": "100",
        },
    )
    assert resp.status_code == 422


def test_finance_requires_auth(admin_client: TestClient) -> None:
    resp = admin_client.get("/v1/admin/finance/transactions")
    assert resp.status_code == 401
