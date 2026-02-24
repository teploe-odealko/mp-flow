from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg
from proxy.src.repositories.admin.base import safe_execute, safe_fetch, safe_fetchone

USER_COLUMNS = "id, username, full_name, is_admin, is_active, created_at, updated_at"
USER_COLUMNS_WITH_HASH = f"{USER_COLUMNS}, password_hash"


async def get_by_username(conn: asyncpg.Connection, *, username: str) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        f"SELECT {USER_COLUMNS_WITH_HASH} FROM admin_users WHERE username = $1",
        username,
    )


async def get_by_id(conn: asyncpg.Connection, *, user_id: str | UUID) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        f"SELECT {USER_COLUMNS} FROM admin_users WHERE id = $1",
        str(user_id),
    )


async def list_users(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        f"SELECT {USER_COLUMNS} FROM admin_users ORDER BY created_at ASC",
    )


async def create_user(
    conn: asyncpg.Connection,
    *,
    username: str,
    full_name: str | None,
    password_hash: str,
    is_admin: bool,
    is_active: bool,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        f"""
        INSERT INTO admin_users (username, full_name, password_hash, is_admin, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING {USER_COLUMNS}
        """,
        username,
        full_name,
        password_hash,
        is_admin,
        is_active,
    )


async def update_user(
    conn: asyncpg.Connection,
    *,
    user_id: str | UUID,
    fields: dict[str, Any],
) -> asyncpg.Record | None:
    if not fields:
        return None

    values: list[Any] = []
    set_parts: list[str] = []
    for key, value in fields.items():
        values.append(value)
        set_parts.append(f"{key} = ${len(values)}")
    set_parts.append("updated_at = NOW()")
    values.append(str(user_id))

    query = f"""
        UPDATE admin_users
        SET {", ".join(set_parts)}
        WHERE id = ${len(values)}
        RETURNING {USER_COLUMNS}
    """
    return await safe_fetchone(conn, query, *values)


async def ensure_bootstrap(
    conn: asyncpg.Connection,
    *,
    username: str,
    password_hash: str,
) -> None:
    existing = await safe_fetchone(
        conn,
        "SELECT id FROM admin_users WHERE username = $1",
        username,
    )
    if existing:
        return
    await safe_execute(
        conn,
        """
        INSERT INTO admin_users (username, full_name, password_hash, is_admin, is_active)
        VALUES ($1, $2, $3, TRUE, TRUE)
        """,
        username,
        "Bootstrap Admin",
        password_hash,
    )
