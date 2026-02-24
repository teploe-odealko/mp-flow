from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg


def to_rfc3339_utc(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def serialize_value(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(("{", "[")):
        try:
            return serialize_value(json.loads(value))
        except (json.JSONDecodeError, ValueError):
            pass
    if isinstance(value, datetime):
        return to_rfc3339_utc(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, list):
        return [serialize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: serialize_value(item) for key, item in value.items()}
    return value


def record_to_dict(record: asyncpg.Record | None) -> dict[str, Any] | None:
    if record is None:
        return None
    return {key: serialize_value(record[key]) for key in record.keys()}


def rows_to_dicts(rows: list[asyncpg.Record]) -> list[dict[str, Any]]:
    return [{key: serialize_value(row[key]) for key in row.keys()} for row in rows]


def parse_jsonb(value: Any) -> dict[str, Any]:
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
