from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import Depends, HTTPException, Request, status
from proxy.src.config import settings
from proxy.src.services.admin_security import decode_admin_token, hash_password

MIGRATION_HINT = (
    "Admin ERP schema is missing or outdated. "
    "Apply migrations: migrations/008_admin_erp.sql, migrations/009_admin_erp_integrations.sql "
    "and migrations/016_admin_credentials_encryption.sql"
)


def _parse_jsonb(value: Any) -> dict[str, Any]:
    """Safely parse a JSONB column value (asyncpg returns str by default)."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return {}


def _serialize_value(value: Any) -> Any:
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    # asyncpg returns JSONB as str — parse it so API returns proper objects
    if isinstance(value, str) and value.startswith(("{", "[")):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, ValueError):
            pass
    return value


def _record_to_dict(record: asyncpg.Record | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return {key: _serialize_value(record[key]) for key in record.keys()}


def _rows_to_dicts(rows: list[asyncpg.Record]) -> list[dict[str, Any]]:
    return [{key: _serialize_value(row[key]) for key in row.keys()} for row in rows]


def _extract_bearer_token(request: Request) -> str:
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


def _parse_date_safe(value: str | None, *, default: date) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {value}") from exc


def _date_bounds(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to must be >= date_from")
    start_dt = datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc)
    end_dt = datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    return start_dt, end_dt


def _date_windows(date_from: date, date_to: date, *, window_days: int) -> list[tuple[date, date]]:
    if window_days <= 0:
        raise ValueError("window_days must be > 0")
    if date_to < date_from:
        return []

    windows: list[tuple[date, date]] = []
    cursor = date_from
    step = timedelta(days=window_days - 1)
    while cursor <= date_to:
        window_end = min(date_to, cursor + step)
        windows.append((cursor, window_end))
        cursor = window_end + timedelta(days=1)
    return windows


def _ensure_db_pool(request: Request) -> asyncpg.Pool:
    pool = getattr(request.app.state, "db_pool", None)
    if not pool:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database not available",
        )
    return pool


async def _safe_fetchone(conn: asyncpg.Connection, query: str, *args: Any) -> asyncpg.Record | None:
    try:
        return await conn.fetchrow(query, *args)
    except (asyncpg.exceptions.UndefinedTableError, asyncpg.exceptions.UndefinedColumnError) as exc:
        raise HTTPException(status_code=503, detail=MIGRATION_HINT) from exc


async def _safe_fetch(conn: asyncpg.Connection, query: str, *args: Any) -> list[asyncpg.Record]:
    try:
        return await conn.fetch(query, *args)
    except (asyncpg.exceptions.UndefinedTableError, asyncpg.exceptions.UndefinedColumnError) as exc:
        raise HTTPException(status_code=503, detail=MIGRATION_HINT) from exc


async def _safe_execute(conn: asyncpg.Connection, query: str, *args: Any) -> str:
    try:
        return await conn.execute(query, *args)
    except (asyncpg.exceptions.UndefinedTableError, asyncpg.exceptions.UndefinedColumnError) as exc:
        raise HTTPException(status_code=503, detail=MIGRATION_HINT) from exc


async def _ensure_bootstrap_admin(conn: asyncpg.Connection) -> None:
    """
    Ensure initial admin user exists if bootstrap env vars are configured.
    """
    if not settings.admin_bootstrap_password:
        return

    username = settings.admin_bootstrap_username
    existing = await _safe_fetchone(
        conn,
        """
        SELECT id, username, is_active
        FROM admin_users
        WHERE username = $1
        """,
        username,
    )
    if existing:
        return

    password_hash = hash_password(settings.admin_bootstrap_password)
    await _safe_execute(
        conn,
        """
        INSERT INTO admin_users (username, full_name, password_hash, is_admin, is_active)
        VALUES ($1, $2, $3, TRUE, TRUE)
        """,
        username,
        "Bootstrap Admin",
        password_hash,
    )


async def _resolve_current_admin(request: Request) -> dict[str, Any]:
    token = _extract_bearer_token(request)
    try:
        claims = decode_admin_token(secret=settings.hmac_secret, token=token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    pool = _ensure_db_pool(request)
    async with pool.acquire() as conn:
        row = await _safe_fetchone(
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
        if not claims.is_admin and row["is_admin"]:
            # DB role was upgraded, refresh token by forcing re-login.
            raise HTTPException(status_code=401, detail="Token role mismatch, please login again")
        return _record_to_dict(row) or {}


async def get_current_admin(request: Request) -> dict[str, Any]:
    return await _resolve_current_admin(request)


async def require_admin(admin: dict[str, Any] = Depends(get_current_admin)) -> dict[str, Any]:
    if not admin.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin permissions required")
    return admin


def _token_ttl_seconds() -> int:
    return max(1, int(settings.admin_token_ttl_hours)) * 3600


def _build_sale_external_id(
    marketplace: str, external_order_id: str | None
) -> tuple[str, str | None]:
    market = (marketplace or "ozon").strip().lower()
    return market, (external_order_id.strip() if external_order_id else None)


def _to_decimal_for_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _to_decimal_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimal_for_json(v) for v in value]
    return value


def _source_key(provider: str, external_ref: str | None) -> str:
    ref = (external_ref or provider).strip().lower()
    digest = sha256(ref.encode("utf-8")).hexdigest()[:12]
    return f"{provider}:{digest}"


def _coerce_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        parsed = float(str(value).strip())
        if parsed <= 0:
            return None
        return round(parsed, 3)
    except (ValueError, TypeError):
        return None


def _merge_dimensions(
    attributes: dict[str, Any] | None,
    dimensions: dict[str, Any],
    *,
    overwrite: bool = False,
) -> dict[str, Any]:
    safe_attributes = dict(attributes) if isinstance(attributes, dict) else {}
    current = safe_attributes.get("dimensions")
    if not isinstance(current, dict):
        current = {}

    for key, value in dimensions.items():
        normalized = _coerce_float(value)
        if normalized is None:
            continue
        if overwrite or current.get(key) in (None, "", 0, 0.0):
            current[key] = normalized

    safe_attributes["dimensions"] = current
    return safe_attributes


def _masked_credential(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 6:
        return "*" * len(value)
    return f"{value[:3]}{'*' * (len(value) - 6)}{value[-3:]}"


async def _get_admin_ozon_creds(
    conn: asyncpg.Connection,
    admin_user_id: str,
) -> tuple[str | None, str | None]:
    row = await _safe_fetchone(
        conn,
        """
        SELECT
            COALESCE(
                pgp_sym_decrypt(ozon_client_id_enc, $2),
                ozon_client_id
            ) AS ozon_client_id,
            COALESCE(
                pgp_sym_decrypt(ozon_api_key_enc, $2),
                ozon_api_key
            ) AS ozon_api_key
        FROM admin_users
        WHERE id = $1
        """,
        admin_user_id,
        settings.hmac_secret,
    )
    if not row:
        return None, None
    client_id = str(row["ozon_client_id"]).strip() if row["ozon_client_id"] else None
    api_key = str(row["ozon_api_key"]).strip() if row["ozon_api_key"] else None
    return client_id, api_key
