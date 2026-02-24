"""MCP auth middleware.

Supports two token types:
- mpk_ API keys: validated directly against the database
- Logto JWT: verified via mcpauth library (userinfo endpoint)

Both paths resolve the user and set McpDeps ContextVar for tool handlers.
"""

from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from typing import Any

import asyncpg
from proxy.src.config import settings
from proxy.src.mcp.deps import McpDeps, set_deps
from proxy.src.repositories.admin.base import safe_fetchone
from proxy.src.services.admin import api_key_service

logger = logging.getLogger(__name__)


def _resource_metadata_url() -> str:
    return f"{settings.base_url}/.well-known/oauth-protected-resource"


def _has_scope(scopes: list[str], required: str) -> bool:
    """Check if scopes list grants access. Empty scopes = unrestricted."""
    for s in scopes:
        if s == "*" or s == required or s.startswith(f"{required}:"):
            return True
    return False


class McpAuthMiddleware:
    """ASGI middleware: mpk_ keys validated directly, JWT via mcpauth verify."""

    def __init__(
        self,
        app: Any,
        pool_getter: Any,
        verify_jwt_fn: Any = None,
        auth_context: ContextVar | None = None,
    ) -> None:
        self.app = app
        self._pool_getter = pool_getter
        self._verify_jwt = verify_jwt_fn
        self._auth_context = auth_context

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")

        if not auth_header.startswith("Bearer "):
            await _send_401(send, "Missing Authorization: Bearer <token>")
            return

        token = auth_header[7:].strip()

        pool: asyncpg.Pool = self._pool_getter()
        if not pool:
            await _send_503(send, "Database not available")
            return

        # API key path
        if token.startswith("mpk_"):
            key_info = await api_key_service.validate_key(pool, raw_key=token)
            if not key_info:
                await _send_401(send, "Invalid or expired API key")
                return
            # Enforce scopes: if scopes are defined, require "mcp" or "mcp:*"
            scopes = key_info.get("scopes") or []
            if scopes and not _has_scope(scopes, "mcp"):
                await _send_error(send, 403, "API key does not have 'mcp' scope")
                return
            set_deps(McpDeps(pool=pool, user_id=key_info["user_id"]))
            await self.app(scope, receive, send)
            return

        # JWT verification via Logto userinfo endpoint
        if self._verify_jwt:
            try:
                auth_info = self._verify_jwt(token)
            except Exception as exc:
                logger.warning("MCP token validation failed: %s", exc)
                await _send_401(send, "Invalid or expired token")
                return

            if not auth_info or not auth_info.subject:
                await _send_401(send, "Invalid token")
                return

            if self._auth_context:
                self._auth_context.set(auth_info)

            user_id = await _resolve_user(pool, auth_info.subject, auth_info.claims)
            if not user_id:
                await _send_401(send, "User not found")
                return

            set_deps(McpDeps(pool=pool, user_id=user_id))
            await self.app(scope, receive, send)
            return

        await _send_401(send, "Invalid token format")


async def _resolve_user(pool: asyncpg.Pool, sub: str, claims: dict) -> str | None:
    """Look up user by Logto sub, with fallback to username."""
    async with pool.acquire() as conn:
        row = await safe_fetchone(
            conn,
            "SELECT id FROM admin_users WHERE logto_sub = $1",
            sub,
        )
        if row:
            return str(row["id"])

        username = claims.get("username") or claims.get("preferred_username") or sub
        row = await safe_fetchone(
            conn,
            "SELECT id FROM admin_users WHERE username = $1 AND logto_sub IS NULL",
            username,
        )
        if row:
            await conn.execute(
                "UPDATE admin_users SET logto_sub = $1 WHERE id = $2",
                sub,
                row["id"],
            )
            return str(row["id"])

    return None


async def _send_401(send: Any, detail: str) -> None:
    url = _resource_metadata_url()
    www_auth = f'Bearer resource_metadata="{url}"'
    await _send_error(
        send,
        401,
        detail,
        extra_headers=[
            [b"www-authenticate", www_auth.encode()],
        ],
    )


async def _send_503(send: Any, detail: str) -> None:
    await _send_error(send, 503, detail)


async def _send_error(
    send: Any,
    status: int,
    detail: str,
    extra_headers: list[list[bytes]] | None = None,
) -> None:
    body = json.dumps({"error": detail}).encode("utf-8")
    headers: list[list[bytes]] = [
        [b"content-type", b"application/json"],
        [b"content-length", str(len(body)).encode()],
    ]
    if extra_headers:
        headers.extend(extra_headers)
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": headers,
        }
    )
    await send({"type": "http.response.body", "body": body})
