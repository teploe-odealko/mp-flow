from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient) -> str:
    resp = client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _create_card(client: TestClient, title: str = "Order Test Card") -> str:
    resp = client.post("/v1/admin/master-cards", json={"title": title})
    assert resp.status_code == 200, resp.text
    return resp.json()["item"]["id"]


def _create_order(client: TestClient, card_id: str) -> dict:
    resp = client.post(
        "/v1/admin/supplier-orders",
        json={
            "supplier_name": "Test Supplier",
            "items": [
                {
                    "master_card_id": card_id,
                    "quantity": "10",
                    "purchase_price_rub": "5000.00",
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_create_supplier_order(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client)
    data = _create_order(admin_client, card_id)
    assert data["order"]["status"] == "draft"
    assert len(data["items"]) == 1
    assert data["items"][0]["master_card_id"] == card_id


def test_list_supplier_orders(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "List Order Card")
    _create_order(admin_client, card_id)

    resp = admin_client.get("/v1/admin/supplier-orders")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total"] >= 1
    assert len(data["items"]) >= 1


def test_get_supplier_order_detail(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "Detail Order Card")
    order_data = _create_order(admin_client, card_id)
    order_id = order_data["order"]["id"]

    resp = admin_client.get(f"/v1/admin/supplier-orders/{order_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["order"]["id"] == order_id
    assert len(data["items"]) == 1


def test_update_supplier_order(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "Update Order Card")
    order_data = _create_order(admin_client, card_id)
    order_id = order_data["order"]["id"]

    resp = admin_client.put(
        f"/v1/admin/supplier-orders/{order_id}",
        json={
            "supplier_name": "Updated Supplier",
            "items": [
                {
                    "master_card_id": card_id,
                    "quantity": "20",
                    "purchase_price_rub": "10000.00",
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["order"]["supplier_name"] == "Updated Supplier"


def test_delete_supplier_order(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "Delete Order Card")
    order_data = _create_order(admin_client, card_id)
    order_id = order_data["order"]["id"]

    resp = admin_client.delete(f"/v1/admin/supplier-orders/{order_id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["deleted"] is True

    get_resp = admin_client.get(f"/v1/admin/supplier-orders/{order_id}")
    assert get_resp.status_code == 404


def test_receive_and_unreceive_order(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "Receive Order Card")
    order_data = _create_order(admin_client, card_id)
    order_id = order_data["order"]["id"]

    # Receive
    recv_resp = admin_client.post(f"/v1/admin/supplier-orders/{order_id}/receive")
    assert recv_resp.status_code == 200, recv_resp.text
    recv_data = recv_resp.json()
    assert recv_data["order"]["status"] == "received"
    assert len(recv_data["lots_created"]) == 1
    assert recv_data["purchase_amount_rub"] > 0

    # Check inventory has the lot
    inv_resp = admin_client.get("/v1/admin/inventory")
    assert inv_resp.status_code == 200
    lots = inv_resp.json()["lots"]
    lot_card_ids = [lot["master_card_id"] for lot in lots]
    assert card_id in lot_card_ids

    # Unreceive
    unrec_resp = admin_client.post(f"/v1/admin/supplier-orders/{order_id}/unreceive")
    assert unrec_resp.status_code == 200, unrec_resp.text
    assert unrec_resp.json()["unreceived"] is True


def test_delete_received_order_returns_409(admin_client: TestClient) -> None:
    _login(admin_client)
    card_id = _create_card(admin_client, "No Delete Received Card")
    order_data = _create_order(admin_client, card_id)
    order_id = order_data["order"]["id"]

    admin_client.post(f"/v1/admin/supplier-orders/{order_id}/receive")

    resp = admin_client.delete(f"/v1/admin/supplier-orders/{order_id}")
    assert resp.status_code == 409


def test_orders_require_auth(admin_client: TestClient) -> None:
    resp = admin_client.get("/v1/admin/supplier-orders")
    assert resp.status_code == 401
