from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient) -> str:
    resp = client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _create_card(client: TestClient, title: str = "Sale Test Card") -> str:
    resp = client.post("/v1/admin/master-cards", json={"title": title})
    assert resp.status_code == 200, resp.text
    return resp.json()["item"]["id"]


def _stock_card(client: TestClient, card_id: str, qty: str = "100", cost: str = "200") -> None:
    resp = client.post(
        "/v1/admin/inventory/initial-balance",
        json={"items": [{"master_card_id": card_id, "quantity": qty, "unit_cost_rub": cost}]},
    )
    assert resp.status_code == 200, resp.text


def test_list_sales(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.get("/v1/admin/sales")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "items" in data
    assert "total" in data


def test_create_sale_with_fifo(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "FIFO Sale Card")
    _stock_card(admin_client, card_id, qty="50", cost="150.00")

    resp = admin_client.post(
        "/v1/admin/sales",
        json={
            "marketplace": "manual",
            "items": [
                {
                    "master_card_id": card_id,
                    "quantity": "5",
                    "unit_sale_price_rub": "500.00",
                    "fee_rub": "50.00",
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["existing"] is False
    assert len(data["items"]) == 1
    item = data["items"][0]
    assert item["master_card_id"] == card_id
    assert len(item["allocations"]) >= 1


def test_create_sale_insufficient_inventory(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "No Stock Sale Card")

    resp = admin_client.post(
        "/v1/admin/sales",
        json={
            "items": [
                {
                    "master_card_id": card_id,
                    "quantity": "10",
                    "unit_sale_price_rub": "100",
                }
            ],
        },
    )
    assert resp.status_code == 400
    assert "Insufficient" in resp.json()["detail"]


def test_create_sale_idempotent(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "Idempotent Sale Card")
    _stock_card(admin_client, card_id, qty="100", cost="100")

    sale_json = {
        "marketplace": "ozon",
        "external_order_id": "test-idempotent-123",
        "items": [
            {
                "master_card_id": card_id,
                "quantity": "2",
                "unit_sale_price_rub": "300",
            }
        ],
    }
    resp1 = admin_client.post("/v1/admin/sales", json=sale_json)
    assert resp1.status_code == 200
    assert resp1.json()["existing"] is False

    resp2 = admin_client.post("/v1/admin/sales", json=sale_json)
    assert resp2.status_code == 200
    assert resp2.json()["existing"] is True


def test_sales_require_auth(admin_client: TestClient) -> None:
    resp = admin_client.get("/v1/admin/sales")
    assert resp.status_code == 401
