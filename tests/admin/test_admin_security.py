from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

from proxy.src.routes.admin_helpers import _extract_bearer_token
from proxy.src.services.admin_security import (
    create_admin_token,
    decode_admin_token,
    hash_password,
    verify_password,
)


def test_password_hash_roundtrip() -> None:
    password = "super-secret-123"
    encoded = hash_password(password)
    assert encoded.startswith("scrypt$")
    assert verify_password(password, encoded) is True
    assert verify_password("wrong-password", encoded) is False


def test_admin_token_roundtrip() -> None:
    secret = "test-secret"
    token = create_admin_token(
        secret=secret,
        user_id="u-1",
        username="admin",
        is_admin=True,
        ttl_seconds=3600,
    )
    claims = decode_admin_token(secret=secret, token=token)
    assert claims.user_id == "u-1"
    assert claims.username == "admin"
    assert claims.is_admin is True
    assert claims.exp > int(time.time())


def test_admin_token_expired() -> None:
    secret = "test-secret"
    token = create_admin_token(
        secret=secret,
        user_id="u-1",
        username="admin",
        is_admin=False,
        ttl_seconds=1,
    )
    claims = decode_admin_token(secret=secret, token=token, now_ts=int(time.time()))
    assert claims.user_id == "u-1"

    try:
        decode_admin_token(secret=secret, token=token, now_ts=int(time.time()) + 2)
    except ValueError as exc:
        assert "expired" in str(exc)
    else:
        raise AssertionError("Expected token to be expired")


def test_extract_bearer_token_prefers_authorization_header() -> None:
    from starlette.requests import Request

    request = Request(
        {
            "type": "http",
            "headers": [
                (b"authorization", b"Bearer header-token"),
                (b"cookie", b"admin_token=cookie-token"),
            ],
        }
    )
    assert _extract_bearer_token(request) == "header-token"


def test_extract_bearer_token_falls_back_to_cookie() -> None:
    from starlette.requests import Request

    request = Request(
        {
            "type": "http",
            "headers": [
                (b"cookie", b"foo=bar; admin_token=cookie-token; baz=qux"),
            ],
        }
    )
    assert _extract_bearer_token(request) == "cookie-token"


def test_extract_bearer_token_raises_without_auth() -> None:
    from starlette.requests import Request

    request = Request({"type": "http", "headers": []})
    with pytest.raises(HTTPException) as exc_info:
        _extract_bearer_token(request)
    assert exc_info.value.status_code == 401
