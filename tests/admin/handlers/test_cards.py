from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _login(client: TestClient) -> str:
    resp = client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def test_create_card(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.post(
        "/v1/admin/master-cards",
        json={"title": "Test Card", "sku": "TC-001", "brand": "TestBrand"},
    )
    assert resp.status_code == 200, resp.text
    item = resp.json()["item"]
    assert item["title"] == "Test Card"
    assert item["sku"] == "TC-001"
    assert item["brand"] == "TestBrand"
    assert item["status"] == "draft"


def test_create_card_requires_title(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.post("/v1/admin/master-cards", json={"sku": "NO-TITLE"})
    assert resp.status_code == 422


def test_list_cards(admin_client: TestClient) -> None:
    _login(admin_client)
    admin_client.post("/v1/admin/master-cards", json={"title": "List Card 1"})
    admin_client.post("/v1/admin/master-cards", json={"title": "List Card 2"})

    resp = admin_client.get("/v1/admin/master-cards")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] >= 2


def test_list_cards_search(admin_client: TestClient) -> None:
    _login(admin_client)
    admin_client.post("/v1/admin/master-cards", json={"title": "Unique Searchable Widget"})

    resp = admin_client.get("/v1/admin/master-cards", params={"q": "Unique Searchable"})
    assert resp.status_code == 200, resp.text
    titles = [i["title"] for i in resp.json()["items"]]
    assert any("Unique Searchable" in t for t in titles)


def test_get_card_detail(admin_client: TestClient) -> None:
    _login(admin_client)
    create_resp = admin_client.post("/v1/admin/master-cards", json={"title": "Detail Card"})
    card_id = create_resp.json()["item"]["id"]

    resp = admin_client.get(f"/v1/admin/master-cards/{card_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["item"]["title"] == "Detail Card"
    assert "lots" in data
    assert "sales" in data


def test_get_card_not_found(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.get("/v1/admin/master-cards/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


def test_update_card(admin_client: TestClient) -> None:
    _login(admin_client)
    create_resp = admin_client.post("/v1/admin/master-cards", json={"title": "Before Update"})
    card_id = create_resp.json()["item"]["id"]

    resp = admin_client.patch(
        f"/v1/admin/master-cards/{card_id}",
        json={"title": "After Update", "brand": "NewBrand"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["item"]["title"] == "After Update"
    assert resp.json()["item"]["brand"] == "NewBrand"


def test_preview_1688(admin_client: TestClient) -> None:
    _login(admin_client)

    mock_payload = {
        "data": {
            "item": {
                "title": "Test 1688 Product",
                "itemId": "123456",
                "images": ["https://example.com/img.jpg"],
                "skuMap": {},
            }
        }
    }
    with patch(
        "proxy.src.services.admin.card_service.fetch_1688_item",
        new_callable=AsyncMock,
        return_value=mock_payload,
    ):
        resp = admin_client.post(
            "/v1/admin/master-cards/sources/1688/preview",
            json={"url": "https://detail.1688.com/offer/123456.html"},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["title"] == "Test 1688 Product"
    assert data["item_id"] == "123456"


def test_import_1688(admin_client: TestClient) -> None:
    _login(admin_client)
    create_resp = admin_client.post("/v1/admin/master-cards", json={"title": "Card for 1688"})
    card_id = create_resp.json()["item"]["id"]

    mock_payload = {
        "data": {
            "item": {
                "title": "Imported 1688 Product",
                "itemId": "789012",
                "url": "https://detail.1688.com/offer/789012.html",
                "images": ["https://example.com/img.jpg"],
                "priceMin": "15.50",
                "priceMax": "20.00",
                "skuMap": {},
            }
        }
    }
    with patch(
        "proxy.src.services.admin.card_service.fetch_1688_item",
        new_callable=AsyncMock,
        return_value=mock_payload,
    ):
        resp = admin_client.post(
            f"/v1/admin/master-cards/{card_id}/sources/1688/import",
            json={"url": "https://detail.1688.com/offer/789012.html"},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["item"]["id"] == card_id
    assert "source" in data


def test_requires_auth(admin_client: TestClient) -> None:
    resp = admin_client.get("/v1/admin/master-cards")
    assert resp.status_code == 401
