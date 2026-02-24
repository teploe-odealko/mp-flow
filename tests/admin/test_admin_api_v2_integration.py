from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import asyncpg
from fastapi.testclient import TestClient


def _login_v2(client: TestClient, username: str, password: str) -> str:
    resp = client.post("/v1/admin/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _db_fetchone(dsn: str, query: str, *args: object) -> asyncpg.Record | None:
    async def _run() -> asyncpg.Record | None:
        conn = await asyncpg.connect(dsn=dsn)
        try:
            return await conn.fetchrow(query, *args)
        finally:
            await conn.close()

    return asyncio.run(_run())


def _db_execute(dsn: str, query: str, *args: object) -> str:
    async def _run() -> str:
        conn = await asyncpg.connect(dsn=dsn)
        try:
            return await conn.execute(query, *args)
        finally:
            await conn.close()

    return asyncio.run(_run())


def test_v2_problem_json_validation_contract(admin_client: TestClient) -> None:
    resp = admin_client.post("/v1/admin/auth/login", json={"username": "x"})
    assert resp.status_code == 422, resp.text
    assert resp.headers.get("content-type", "").startswith("application/problem+json")

    payload = resp.json()
    assert payload["error_code"] == "validation_error"
    assert payload["status"] == 422
    assert payload["instance"] == "/v1/admin/auth/login"
    assert isinstance(payload.get("invalid_params"), list)


def test_v1_admin_api_login_works(admin_client: TestClient) -> None:
    resp = admin_client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    assert "access_token" in resp.json()


def test_v2_tenant_isolation_for_catalog_cards(admin_client: TestClient) -> None:
    admin_token = _login_v2(admin_client, "admin", "admin-strong-pass")

    create_user_resp = admin_client.post(
        "/v1/admin/users",
        headers=_auth_headers(admin_token),
        json={
            "username": "worker",
            "password": "worker-pass-123",
            "full_name": "Worker User",
            "is_admin": False,
            "is_active": True,
        },
    )
    assert create_user_resp.status_code == 200, create_user_resp.text

    worker_token = _login_v2(admin_client, "worker", "worker-pass-123")

    worker_card = admin_client.post(
        "/v1/admin/master-cards",
        headers=_auth_headers(worker_token),
        json={"title": "Worker Card", "sku": "W-1", "status": "active", "attributes": {}},
    )
    assert worker_card.status_code == 200, worker_card.text
    worker_card_id = worker_card.json()["item"]["id"]

    admin_card = admin_client.post(
        "/v1/admin/master-cards",
        headers=_auth_headers(admin_token),
        json={"title": "Admin Card", "sku": "A-1", "status": "active", "attributes": {}},
    )
    assert admin_card.status_code == 200, admin_card.text
    admin_card_id = admin_card.json()["item"]["id"]

    worker_list = admin_client.get(
        "/v1/admin/master-cards",
        headers=_auth_headers(worker_token),
    )
    assert worker_list.status_code == 200, worker_list.text
    worker_ids = {item["id"] for item in worker_list.json()["items"]}
    assert worker_card_id in worker_ids
    assert admin_card_id not in worker_ids

    admin_list = admin_client.get(
        "/v1/admin/master-cards",
        headers=_auth_headers(admin_token),
    )
    assert admin_list.status_code == 200, admin_list.text
    admin_ids = {item["id"] for item in admin_list.json()["items"]}
    assert admin_card_id in admin_ids
    assert worker_card_id not in admin_ids


def test_v2_ozon_accounts_entity_and_encrypted_storage(
    admin_client: TestClient,
    postgres_dsn: str,
) -> None:
    admin_token = _login_v2(admin_client, "admin", "admin-strong-pass")

    create_user_resp = admin_client.post(
        "/v1/admin/users",
        headers=_auth_headers(admin_token),
        json={
            "username": "merchant",
            "password": "merchant-pass-123",
            "full_name": "Merchant",
            "is_admin": False,
            "is_active": True,
        },
    )
    assert create_user_resp.status_code == 200, create_user_resp.text
    merchant_id = create_user_resp.json()["item"]["id"]

    merchant_token = _login_v2(admin_client, "merchant", "merchant-pass-123")

    create_acc_resp = admin_client.post(
        "/v1/admin/integrations/ozon/accounts",
        headers=_auth_headers(merchant_token),
        json={
            "name": "main",
            "client_id": "cid-xyz",
            "api_key": "api-xyz",
            "is_active": True,
            "is_default": True,
        },
    )
    assert create_acc_resp.status_code == 200, create_acc_resp.text
    account_id = create_acc_resp.json()["item"]["id"]

    db_row = _db_fetchone(
        postgres_dsn,
        """
        SELECT user_id, client_id_enc, api_key_enc
        FROM admin_ozon_accounts
        WHERE id = $1
        """,
        account_id,
    )
    assert db_row is not None
    assert str(db_row["user_id"]) == merchant_id
    assert db_row["client_id_enc"] is not None
    assert db_row["api_key_enc"] is not None

    merchant_list = admin_client.get(
        "/v1/admin/integrations/ozon/accounts",
        headers=_auth_headers(merchant_token),
    )
    assert merchant_list.status_code == 200, merchant_list.text
    merchant_ids = {item["id"] for item in merchant_list.json()["items"]}
    assert account_id in merchant_ids

    admin_list = admin_client.get(
        "/v1/admin/integrations/ozon/accounts",
        headers=_auth_headers(admin_token),
    )
    assert admin_list.status_code == 200, admin_list.text
    admin_ids = {item["id"] for item in admin_list.json()["items"]}
    assert account_id not in admin_ids


def test_v2_pagination_sort_and_rfc3339_time_contract(admin_client: TestClient) -> None:
    token = _login_v2(admin_client, "admin", "admin-strong-pass")

    for idx in range(2):
        resp = admin_client.post(
            "/v1/admin/master-cards",
            headers=_auth_headers(token),
            json={
                "title": f"Card {idx}",
                "sku": f"SKU-{idx}",
                "status": "active",
                "attributes": {},
            },
        )
        assert resp.status_code == 200, resp.text

    first_page = admin_client.get(
        "/v1/admin/master-cards",
        headers=_auth_headers(token),
        params={"limit": 1},
    )
    assert first_page.status_code == 200, first_page.text
    p1 = first_page.json()
    assert len(p1["items"]) == 1
    assert p1["items"][0]["created_at"].endswith("Z")
    assert p1["total"] >= 2

    second_page = admin_client.get(
        "/v1/admin/master-cards",
        headers=_auth_headers(token),
        params={"limit": 1, "offset": 1},
    )
    assert second_page.status_code == 200, second_page.text
    p2 = second_page.json()
    assert len(p2["items"]) == 1

    first_id = p1["items"][0]["id"]
    second_id = p2["items"][0]["id"]
    assert first_id != second_id


def test_v2_legacy_unit_economics_is_tenant_scoped(
    admin_client: TestClient,
    postgres_dsn: str,
) -> None:
    admin_token = _login_v2(admin_client, "admin", "admin-strong-pass")
    admin_me = admin_client.get("/v1/admin/auth/me", headers=_auth_headers(admin_token))
    assert admin_me.status_code == 200, admin_me.text
    admin_id = admin_me.json()["user"]["id"]

    create_user_resp = admin_client.post(
        "/v1/admin/users",
        headers=_auth_headers(admin_token),
        json={
            "username": "analytics-worker",
            "password": "analytics-pass-123",
            "full_name": "Analytics Worker",
            "is_admin": False,
            "is_active": True,
        },
    )
    assert create_user_resp.status_code == 200, create_user_resp.text
    worker_id = create_user_resp.json()["item"]["id"]
    worker_token = _login_v2(admin_client, "analytics-worker", "analytics-pass-123")

    now = datetime.now(tz=UTC)
    _db_execute(
        postgres_dsn,
        """
        INSERT INTO ozon_sku_economics (
            user_id, operation_id, operation_date, operation_type, posting_number, sku, product_name,
            revenue, sale_commission, total_amount
        )
        VALUES
            ($1, 1001, $3, 'OperationAgentDeliveredToCustomer', 'P-ADMIN', 111, 'Admin Product', 1000, -120, 880),
            ($2, 2001, $3, 'OperationAgentDeliveredToCustomer', 'P-WORKER', 222, 'Worker Product', 9000, -900, 8100)
        """,
        admin_id,
        worker_id,
        now,
    )

    admin_report = admin_client.get(
        "/v1/admin/reports/unit-economics",
        headers=_auth_headers(admin_token),
        params={"date_from": now.date().isoformat(), "date_to": now.date().isoformat()},
    )
    assert admin_report.status_code == 200, admin_report.text
    admin_items = admin_report.json()["items"]
    admin_skus = {item["sku"] for item in admin_items}
    assert 111 in admin_skus
    assert 222 not in admin_skus

    worker_report = admin_client.get(
        "/v1/admin/reports/unit-economics",
        headers=_auth_headers(worker_token),
        params={"date_from": now.date().isoformat(), "date_to": now.date().isoformat()},
    )
    assert worker_report.status_code == 200, worker_report.text
    worker_items = worker_report.json()["items"]
    worker_skus = {item["sku"] for item in worker_items}
    assert 222 in worker_skus
    assert 111 not in worker_skus


def test_v2_legacy_logistics_sku_excludes_foreign_supply_and_orders(
    admin_client: TestClient,
    postgres_dsn: str,
) -> None:
    admin_token = _login_v2(admin_client, "admin", "admin-strong-pass")
    create_user_resp = admin_client.post(
        "/v1/admin/users",
        headers=_auth_headers(admin_token),
        json={
            "username": "log-worker",
            "password": "log-pass-123",
            "full_name": "Log Worker",
            "is_admin": False,
            "is_active": True,
        },
    )
    assert create_user_resp.status_code == 200, create_user_resp.text
    worker_id = create_user_resp.json()["item"]["id"]

    create_card_resp = admin_client.post(
        "/v1/admin/master-cards",
        headers=_auth_headers(admin_token),
        json={"title": "Admin SKU", "sku": "ADM-LOG-1"},
    )
    assert create_card_resp.status_code == 200, create_card_resp.text
    card_id = create_card_resp.json()["item"]["id"]

    foreign_order = _db_fetchone(
        postgres_dsn,
        """
        INSERT INTO supplier_orders (
            order_number, supplier_name, status, currency, order_date, user_id
        )
        VALUES ('SO-FOREIGN-1', 'Foreign Supplier', 'received', 'RUB', CURRENT_DATE, $1)
        RETURNING id
        """,
        worker_id,
    )
    assert foreign_order is not None
    foreign_order_id = str(foreign_order["id"])

    foreign_supply = _db_fetchone(
        postgres_dsn,
        """
        INSERT INTO ozon_supplies (
            user_id, ozon_supply_order_id, supply_number, status
        )
        VALUES ($1, 555001, 'SUP-FOREIGN-1', 'IN_PROGRESS')
        RETURNING id
        """,
        worker_id,
    )
    assert foreign_supply is not None
    foreign_supply_id = str(foreign_supply["id"])

    _db_execute(
        postgres_dsn,
        """
        INSERT INTO supplier_order_items (
            supplier_order_id, master_card_id, title, quantity, unit_cost_rub
        )
        VALUES ($1, $2, 'Foreign Item', 5, 100)
        """,
        foreign_order_id,
        card_id,
    )
    _db_execute(
        postgres_dsn,
        """
        INSERT INTO ozon_supply_items (
            ozon_supply_id, master_card_id, ozon_offer_id, product_name, quantity_planned, quantity_accepted, quantity_rejected
        )
        VALUES ($1, $2, 'offer-foreign', 'Foreign Supply Item', 7, 0, 0)
        """,
        foreign_supply_id,
        card_id,
    )

    detail_resp = admin_client.get(
        f"/v1/admin/logistics/sku/{card_id}",
        headers=_auth_headers(admin_token),
    )
    assert detail_resp.status_code == 200, detail_resp.text
    payload = detail_resp.json()
    assert payload["card"]["id"] == card_id
    assert payload["supplier_orders"] == []
    assert payload["ozon_supplies"] == []


def test_v2_legacy_ozon_stocks_requires_personal_credentials(admin_client: TestClient) -> None:
    token = _login_v2(admin_client, "admin", "admin-strong-pass")
    resp = admin_client.post("/v1/admin/ozon/stocks", headers=_auth_headers(token), json={})
    assert resp.status_code == 400, resp.text
    assert "Ozon credentials are required" in resp.json()["detail"]
