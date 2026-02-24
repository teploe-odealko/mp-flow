from __future__ import annotations

import hashlib
import secrets
from typing import Any

import asyncpg
from fastapi import HTTPException
from proxy.src.repositories.admin import api_key_repo
from proxy.src.routes.admin.serialization import record_to_dict, rows_to_dicts

KEY_PREFIX = "mpk_"


def _generate_raw_key() -> str:
    return KEY_PREFIX + secrets.token_hex(16)


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _key_prefix(raw_key: str) -> str:
    return raw_key[:8]


async def create_key(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    name: str,
) -> dict[str, Any]:
    raw_key = _generate_raw_key()
    key_hash = _hash_key(raw_key)
    prefix = _key_prefix(raw_key)

    row = await api_key_repo.create(
        conn, user_id=user_id, key_hash=key_hash, key_prefix=prefix, name=name
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create API key")
    result = record_to_dict(row) or {}
    result["raw_key"] = raw_key  # shown only once
    return result


async def validate_key(pool: asyncpg.Pool, *, raw_key: str) -> dict[str, Any] | None:
    key_hash = _hash_key(raw_key)
    async with pool.acquire() as conn:
        row = await api_key_repo.find_by_hash(conn, key_hash=key_hash)
        if not row:
            return None
        if not row["user_is_active"]:
            return None
        # fire-and-forget last_used update
        await api_key_repo.touch_last_used(conn, key_id=str(row["id"]))
    return {
        "user_id": str(row["user_id"]),
        "key_id": str(row["id"]),
        "key_name": row["name"],
        "scopes": list(row["scopes"] or []),
        "rate_limit": row["rate_limit"],
    }


async def list_keys(conn: asyncpg.Connection, *, user_id: str) -> dict[str, Any]:
    rows = await api_key_repo.list_by_user(conn, user_id=user_id)
    return {"items": rows_to_dicts(rows)}


async def revoke_key(conn: asyncpg.Connection, *, key_id: str, user_id: str) -> dict[str, Any]:
    row = await api_key_repo.revoke(conn, key_id=key_id, user_id=user_id)
    if not row:
        raise HTTPException(status_code=404, detail="API key not found or already revoked")
    result = record_to_dict(row)
    return result if result else {}
