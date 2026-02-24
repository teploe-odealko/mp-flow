from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient) -> str:
    resp = client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _create_card(client: TestClient, title: str = "Inv Test Card") -> str:
    resp = client.post("/v1/admin/master-cards", json={"title": title})
    assert resp.status_code == 200, resp.text
    return resp.json()["item"]["id"]


def test_inventory_overview(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.get("/v1/admin/inventory")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "summary" in data
    assert "lots" in data
    assert "total_stock_value_rub" in data


def test_initial_balance(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "Initial Balance Card")

    resp = admin_client.post(
        "/v1/admin/inventory/initial-balance",
        json={
            "items": [
                {
                    "master_card_id": card_id,
                    "quantity": "50",
                    "unit_cost_rub": "120.50",
                }
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["items_count"] == 1
    assert len(data["lots_created"]) == 1
    assert data["purchase_amount_rub"] > 0

    # Verify in inventory overview
    inv_resp = admin_client.get("/v1/admin/inventory")
    assert inv_resp.status_code == 200
    lots = inv_resp.json()["lots"]
    our_lots = [lot for lot in lots if lot["master_card_id"] == card_id]
    assert len(our_lots) >= 1


def test_initial_balance_invalid_card_returns_404(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.post(
        "/v1/admin/inventory/initial-balance",
        json={
            "items": [
                {
                    "master_card_id": "00000000-0000-0000-0000-000000000000",
                    "quantity": "10",
                    "unit_cost_rub": "100",
                }
            ]
        },
    )
    assert resp.status_code == 404


def test_inventory_requires_auth(admin_client: TestClient) -> None:
    resp = admin_client.get("/v1/admin/inventory")
    assert resp.status_code == 401
