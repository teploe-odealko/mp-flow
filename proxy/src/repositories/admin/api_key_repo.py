from __future__ import annotations

import asyncpg
from proxy.src.repositories.admin.base import safe_execute, safe_fetch, safe_fetchone

COLUMNS = "id, user_id, key_prefix, name, scopes, rate_limit, created_at, last_used_at, expires_at, revoked_at"
COLUMNS_AK = "ak.id, ak.user_id, ak.key_prefix, ak.name, ak.scopes, ak.rate_limit, ak.created_at, ak.last_used_at, ak.expires_at, ak.revoked_at"


async def create(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    key_hash: str,
    key_prefix: str,
    name: str,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        f"""
        INSERT INTO admin_api_keys (user_id, key_hash, key_prefix, name)
        VALUES ($1, $2, $3, $4)
        RETURNING {COLUMNS}
        """,
        user_id,
        key_hash,
        key_prefix,
        name,
    )


async def find_by_hash(conn: asyncpg.Connection, *, key_hash: str) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        f"""
        SELECT {COLUMNS_AK}, au.is_active AS user_is_active
        FROM admin_api_keys ak
        JOIN admin_users au ON au.id = ak.user_id
        WHERE ak.key_hash = $1
          AND ak.revoked_at IS NULL
          AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
        """,
        key_hash,
    )


async def touch_last_used(conn: asyncpg.Connection, *, key_id: str) -> None:
    await safe_execute(
        conn,
        "UPDATE admin_api_keys SET last_used_at = NOW() WHERE id = $1",
        key_id,
    )


async def list_by_user(conn: asyncpg.Connection, *, user_id: str) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        f"SELECT {COLUMNS} FROM admin_api_keys WHERE user_id = $1 ORDER BY created_at DESC",
        user_id,
    )


async def revoke(conn: asyncpg.Connection, *, key_id: str, user_id: str) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        f"""
        UPDATE admin_api_keys SET revoked_at = NOW()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
        RETURNING {COLUMNS}
        """,
        key_id,
        user_id,
    )
