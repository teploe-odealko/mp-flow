from __future__ import annotations

from fastapi.testclient import TestClient


def _login(client: TestClient) -> str:
    resp = client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def test_login_returns_token_and_sets_cookie(admin_client: TestClient) -> None:
    resp = admin_client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "admin-strong-pass"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] > 0
    assert data["user"]["username"] == "admin"

    set_cookie = resp.headers.get("set-cookie", "")
    assert "admin_token=" in set_cookie
    assert "HttpOnly" in set_cookie


def test_login_rejects_wrong_password(admin_client: TestClient) -> None:
    resp = admin_client.post(
        "/v1/admin/auth/login",
        json={"username": "admin", "password": "wrong"},
    )
    assert resp.status_code == 401


def test_logout_clears_cookie(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.post("/v1/admin/auth/logout")
    assert resp.status_code == 200

    me_resp = admin_client.get("/v1/admin/auth/me")
    assert me_resp.status_code == 401


def test_me_returns_current_user(admin_client: TestClient) -> None:
    _login(admin_client)
    resp = admin_client.get("/v1/admin/auth/me")
    assert resp.status_code == 200
    assert resp.json()["user"]["username"] == "admin"


def test_me_requires_auth(admin_client: TestClient) -> None:
    resp = admin_client.get("/v1/admin/auth/me")
    assert resp.status_code == 401


def test_create_user_and_list(admin_client: TestClient) -> None:
    _login(admin_client)
    create_resp = admin_client.post(
        "/v1/admin/users",
        json={
            "username": "handler-test-user",
            "password": "strong-pass-123",
            "full_name": "Handler Test",
            "is_admin": False,
            "is_active": True,
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    assert create_resp.json()["item"]["username"] == "handler-test-user"

    list_resp = admin_client.get("/v1/admin/users")
    assert list_resp.status_code == 200
    usernames = [u["username"] for u in list_resp.json()["items"]]
    assert "handler-test-user" in usernames


def test_update_user(admin_client: TestClient) -> None:
    _login(admin_client)
    create_resp = admin_client.post(
        "/v1/admin/users",
        json={
            "username": "handler-update-user",
            "password": "strong-pass-123",
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    user_id = create_resp.json()["item"]["id"]

    update_resp = admin_client.patch(
        f"/v1/admin/users/{user_id}",
        json={"full_name": "Updated Name"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["item"]["full_name"] == "Updated Name"


def test_create_duplicate_username_returns_409(admin_client: TestClient) -> None:
    _login(admin_client)
    admin_client.post(
        "/v1/admin/users",
        json={"username": "dup-user", "password": "strong-pass-123"},
    )
    resp = admin_client.post(
        "/v1/admin/users",
        json={"username": "dup-user", "password": "strong-pass-123"},
    )
    assert resp.status_code == 409
