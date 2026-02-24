from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from proxy.src.repositories.admin import finance_repo
from proxy.src.routes.admin.list_query import ListQuery, list_response
from proxy.src.routes.admin.serialization import record_to_dict, rows_to_dicts
from proxy.src.services.admin_logic import to_money


def _parse_date_safe(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return default


def _date_bounds(from_date: Any, to_date: Any) -> tuple[datetime, datetime]:
    if to_date < from_date:
        from_date, to_date = to_date, from_date
    start_dt = datetime(from_date.year, from_date.month, from_date.day, tzinfo=timezone.utc)
    end_dt = datetime(to_date.year, to_date.month, to_date.day, tzinfo=timezone.utc) + timedelta(
        days=1
    )
    return start_dt, end_dt


async def list_transactions(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    lq: ListQuery,
    date_from: str | None,
    date_to: str | None,
    kind: str | None,
    category: str | None,
    source: str | None = None,
) -> dict[str, Any]:
    today = datetime.now(tz=timezone.utc).date()
    from_date = _parse_date_safe(date_from, default=today - timedelta(days=30))
    to_date = _parse_date_safe(date_to, default=today)
    start_dt, end_dt = _date_bounds(from_date, to_date)

    rows, total = await finance_repo.list_transactions(
        conn,
        user_id=user_id,
        lq=lq,
        start_dt=start_dt,
        end_dt=end_dt,
        kind=kind,
        category=category,
        source=source,
    )
    return list_response(rows_to_dicts(rows), total, lq)


def _to_decimal_for_json(value: Any) -> Any:
    from decimal import Decimal

    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _to_decimal_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimal_for_json(v) for v in value]
    return value


async def create_transaction(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    happened_at: datetime | None,
    kind: str,
    category: str,
    subcategory: str | None,
    amount_rub: Any,
    source: str,
    external_id: str | None,
    related_entity_type: str | None,
    related_entity_id: str | None,
    notes: str | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    effective_at = happened_at or datetime.now(tz=timezone.utc)
    row = await finance_repo.create_transaction(
        conn,
        happened_at=effective_at,
        kind=kind,
        category=category,
        subcategory=subcategory,
        amount_rub=to_money(amount_rub),
        source=source,
        external_id=external_id,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        notes=notes,
        payload_json=json.dumps(_to_decimal_for_json(payload)),
        user_id=user_id,
    )
    return {"item": record_to_dict(row)}


async def update_transaction(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    txn_id: str,
    happened_at: datetime | None,
    kind: str | None,
    category: str | None,
    amount_rub: Any | None,
    notes: str | None,
) -> dict[str, Any] | None:
    row = await finance_repo.update_transaction(
        conn,
        txn_id=txn_id,
        user_id=user_id,
        happened_at=happened_at,
        kind=kind,
        category=category,
        amount_rub=to_money(amount_rub) if amount_rub is not None else None,
        notes=notes,
    )
    if not row:
        return None
    return {"item": record_to_dict(row)}


async def delete_transaction(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    txn_id: str,
) -> bool:
    return await finance_repo.delete_transaction(conn, txn_id=txn_id, user_id=user_id)
