from __future__ import annotations

import logging
from typing import Any

import asyncpg
from fastapi import Depends, HTTPException, Request, status
from proxy.src.config import settings
from proxy.src.repositories.admin.base import safe_fetchone
from proxy.src.services.admin import api_key_service
from proxy.src.services.admin_security import decode_admin_token

logger = logging.getLogger(__name__)

API_KEY_PREFIX = "mpk_"

# Lazy-initialized JWKS client for Logto JWT validation
_jwks_client = None


def _row_to_user(row: asyncpg.Record) -> dict[str, Any]:
    """Convert a DB row to a user dict with ISO-formatted timestamps."""
    return {
        "id": str(row["id"]),
        "username": str(row["username"]),
        "full_name": row["full_name"],
        "is_admin": bool(row["is_admin"]),
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and settings.logto_endpoint:
        import jwt

        jwks_uri = f"{settings.logto_endpoint}/oidc/jwks"
        _jwks_client = jwt.PyJWKClient(jwks_uri, cache_keys=True, lifespan=3600)
    return _jwks_client


def get_db_pool(request: Request) -> asyncpg.Pool:
    pool = getattr(request.app.state, "db_pool", None)
    if not pool:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database not available",
        )
    return pool


def _extract_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        token = header[7:].strip()
        if token:
            return token

    cookie_token = request.cookies.get("admin_token", "").strip()
    if cookie_token:
        return cookie_token

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing bearer token",
    )


async def _resolve_api_key(request: Request, raw_key: str) -> dict[str, Any]:
    pool = get_db_pool(request)
    result = await api_key_service.validate_key(pool, raw_key=raw_key)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")

    async with pool.acquire() as conn:
        row = await safe_fetchone(
            conn,
            """
            SELECT id, username, full_name, is_admin, is_active, created_at, updated_at
            FROM admin_users
            WHERE id = $1
            """,
            result["user_id"],
        )
    if not row:
        raise HTTPException(status_code=401, detail="Admin user not found")
    return _row_to_user(row)


async def _resolve_jwt(request: Request, token: str) -> dict[str, Any]:
    """Validate a Logto JWT and return the admin user dict."""
    import jwt as pyjwt

    jwks_client = _get_jwks_client()
    if not jwks_client:
        raise HTTPException(status_code=401, detail="JWT auth not configured")

    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = pyjwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256", "ES384", "ES512"],
            audience=settings.logto_api_resource,
            issuer=f"{settings.logto_endpoint}/oidc",
        )
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Missing sub claim")

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        # Look up user by logto_sub or create on first login
        row = await safe_fetchone(
            conn,
            """
            SELECT id, username, full_name, is_admin, is_active, created_at, updated_at
            FROM admin_users
            WHERE logto_sub = $1
            """,
            sub,
        )
        if not row:
            # Fallback: try matching by username (for migrated users)
            username = payload.get("username") or payload.get("preferred_username") or sub
            row = await safe_fetchone(
                conn,
                """
                SELECT id, username, full_name, is_admin, is_active, created_at, updated_at
                FROM admin_users
                WHERE username = $1 AND logto_sub IS NULL
                """,
                username,
            )
            if row:
                # Link existing user to Logto sub
                await conn.execute(
                    "UPDATE admin_users SET logto_sub = $1 WHERE id = $2",
                    sub,
                    row["id"],
                )
            else:
                # Auto-create user from Logto
                email = payload.get("email") or ""
                full_name = payload.get("name") or username
                row = await safe_fetchone(
                    conn,
                    """
                    INSERT INTO admin_users (username, full_name, password_hash, logto_sub, is_admin, is_active)
                    VALUES ($1, $2, '', $3, FALSE, TRUE)
                    RETURNING id, username, full_name, is_admin, is_active, created_at, updated_at
                    """,
                    email or sub,
                    full_name,
                    sub,
                )

    if not row:
        raise HTTPException(status_code=401, detail="Failed to resolve user")
    if not row["is_active"]:
        raise HTTPException(status_code=403, detail="Admin user is disabled")
    return _row_to_user(row)


def _is_jwt(token: str) -> bool:
    """Check if token looks like a JWT (3 dot-separated base64 parts)."""
    parts = token.split(".")
    return len(parts) == 3 and not token.startswith(API_KEY_PREFIX)


async def get_current_user(request: Request) -> dict[str, Any]:
    token = _extract_token(request)

    if token.startswith(API_KEY_PREFIX):
        return await _resolve_api_key(request, token)

    if _is_jwt(token):
        return await _resolve_jwt(request, token)

    # Legacy HMAC token (keep during migration)
    try:
        claims = decode_admin_token(secret=settings.hmac_secret, token=token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        row = await safe_fetchone(
            conn,
            """
            SELECT id, username, full_name, is_admin, is_active, created_at, updated_at
            FROM admin_users
            WHERE id = $1
            """,
            claims.user_id,
        )
    if not row:
        raise HTTPException(status_code=401, detail="Admin user not found")
    if not row["is_active"]:
        raise HTTPException(status_code=403, detail="Admin user is disabled")
    return _row_to_user(row)


async def require_admin(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin permissions required",
        )
    return user
