from __future__ import annotations

from typing import Any

import asyncpg
from fastapi import HTTPException

MIGRATION_HINT = (
    "Admin ERP schema is missing or outdated. Apply migrations from the migrations/ directory."
)


async def safe_fetchone(conn: asyncpg.Connection, query: str, *args: Any) -> asyncpg.Record | None:
    try:
        return await conn.fetchrow(query, *args)
    except (
        asyncpg.exceptions.UndefinedTableError,
        asyncpg.exceptions.UndefinedColumnError,
    ) as exc:
        raise HTTPException(status_code=503, detail=MIGRATION_HINT) from exc


async def safe_fetch(conn: asyncpg.Connection, query: str, *args: Any) -> list[asyncpg.Record]:
    try:
        return await conn.fetch(query, *args)
    except (
        asyncpg.exceptions.UndefinedTableError,
        asyncpg.exceptions.UndefinedColumnError,
    ) as exc:
        raise HTTPException(status_code=503, detail=MIGRATION_HINT) from exc


async def safe_execute(conn: asyncpg.Connection, query: str, *args: Any) -> str:
    try:
        return await conn.execute(query, *args)
    except (
        asyncpg.exceptions.UndefinedTableError,
        asyncpg.exceptions.UndefinedColumnError,
    ) as exc:
        raise HTTPException(status_code=503, detail=MIGRATION_HINT) from exc
