from __future__ import annotations

from typing import Any

import asyncpg
from fastapi import HTTPException
from proxy.src.config import settings
from proxy.src.repositories.admin import user_repo
from proxy.src.routes.admin.serialization import record_to_dict
from proxy.src.services.admin_security import (
    create_admin_token,
    hash_password,
    verify_password,
)


def token_ttl_seconds() -> int:
    return max(1, int(settings.admin_token_ttl_hours)) * 3600


async def authenticate(conn: asyncpg.Connection, *, username: str, password: str) -> dict[str, Any]:
    await user_repo.ensure_bootstrap(
        conn,
        username=settings.admin_bootstrap_username,
        password_hash=hash_password(settings.admin_bootstrap_password)
        if settings.admin_bootstrap_password
        else "",
    )

    user_row = await user_repo.get_by_username(conn, username=username.strip())
    if not user_row or not verify_password(password, user_row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user_row["is_active"]:
        raise HTTPException(status_code=403, detail="User is disabled")

    token = create_admin_token(
        secret=settings.hmac_secret,
        user_id=str(user_row["id"]),
        username=str(user_row["username"]),
        is_admin=bool(user_row["is_admin"]),
        ttl_seconds=token_ttl_seconds(),
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": token_ttl_seconds(),
        "user": record_to_dict(user_row),
    }


async def list_users(conn: asyncpg.Connection) -> dict[str, Any]:
    from proxy.src.routes.admin.serialization import rows_to_dicts

    rows = await user_repo.list_users(conn)
    return {"items": rows_to_dicts(rows), "total": len(rows)}


async def create_user(
    conn: asyncpg.Connection,
    *,
    username: str,
    password: str,
    full_name: str | None,
    is_admin: bool,
    is_active: bool,
) -> dict[str, Any]:
    existing = await user_repo.get_by_username(conn, username=username.strip())
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    row = await user_repo.create_user(
        conn,
        username=username.strip(),
        full_name=full_name,
        password_hash=hash_password(password),
        is_admin=is_admin,
        is_active=is_active,
    )
    return {"item": record_to_dict(row)}


async def update_user(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    current_user_id: str,
    full_name: str | None = None,
    password: str | None = None,
    is_admin: bool | None = None,
    is_active: bool | None = None,
) -> dict[str, Any]:
    fields: dict[str, Any] = {}

    if full_name is not None:
        fields["full_name"] = full_name
    if is_admin is not None:
        fields["is_admin"] = is_admin
    if is_active is not None:
        if str(user_id) == str(current_user_id) and is_active is False:
            raise HTTPException(status_code=400, detail="You cannot disable yourself")
        fields["is_active"] = is_active
    if password:
        fields["password_hash"] = hash_password(password)

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    row = await user_repo.update_user(conn, user_id=user_id, fields=fields)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return {"item": record_to_dict(row)}
