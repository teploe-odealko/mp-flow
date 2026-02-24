from __future__ import annotations

import asyncio

import asyncpg
from fastapi.testclient import TestClient


def _db_fetchone(dsn: str, query: str, *args: object) -> asyncpg.Record | None:
    async def _run() -> asyncpg.Record | None:
        conn = await asyncpg.connect(dsn=dsn)
        try:
            return await conn.fetchrow(query, *args)
        finally:
            await conn.close()

    return asyncio.run(_run())


def _login(client: TestClient) -> None:
    resp = client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text


def test_admin_login_sets_cookie_and_me_works(admin_client: TestClient) -> None:
    login_resp = admin_client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert login_resp.status_code == 200, login_resp.text
    set_cookie = login_resp.headers.get("set-cookie", "")
    assert "admin_token=" in set_cookie
    assert "HttpOnly" in set_cookie

    me_resp = admin_client.get("/v1/admin/auth/me")
    assert me_resp.status_code == 200, me_resp.text
    assert me_resp.json()["user"]["username"] == "admin"


def test_admin_logout_invalidates_cookie(admin_client: TestClient) -> None:
    _login(admin_client)
    logout_resp = admin_client.post("/v1/admin/auth/logout")
    assert logout_resp.status_code == 200, logout_resp.text

    me_resp = admin_client.get("/v1/admin/auth/me")
    assert me_resp.status_code == 401


def test_ozon_credentials_are_encrypted_at_rest(
    admin_client: TestClient,
    postgres_dsn: str,
) -> None:
    _login(admin_client)

    upsert_resp = admin_client.put(
        "/v1/admin/integrations/ozon",
        json={"client_id": "cid-123", "api_key": "secret-456"},
    )
    assert upsert_resp.status_code == 200, upsert_resp.text

    row = _db_fetchone(
        postgres_dsn,
        """
        SELECT ozon_client_id, ozon_api_key, ozon_client_id_enc, ozon_api_key_enc
        FROM admin_users
        WHERE username = 'admin'
        """,
    )
    assert row is not None
    assert row["ozon_client_id"] is None
    assert row["ozon_api_key"] is None
    assert row["ozon_client_id_enc"] is not None
    assert row["ozon_api_key_enc"] is not None

    get_resp = admin_client.get("/v1/admin/integrations/ozon")
    assert get_resp.status_code == 200, get_resp.text
    payload = get_resp.json()
    assert payload["has_credentials"] is True
    assert payload["client_id_masked"] is not None
    assert payload["api_key_masked"] is not None

    clear_resp = admin_client.delete("/v1/admin/integrations/ozon")
    assert clear_resp.status_code == 200, clear_resp.text
    row_after_clear = _db_fetchone(
        postgres_dsn,
        """
        SELECT ozon_client_id, ozon_api_key, ozon_client_id_enc, ozon_api_key_enc
        FROM admin_users
        WHERE username = 'admin'
        """,
    )
    assert row_after_clear is not None
    assert row_after_clear["ozon_client_id"] is None
    assert row_after_clear["ozon_api_key"] is None
    assert row_after_clear["ozon_client_id_enc"] is None
    assert row_after_clear["ozon_api_key_enc"] is None
