from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import asyncpg
from proxy.src.repositories.admin.base import safe_fetch
from proxy.src.routes.admin.serialization import rows_to_dicts
from proxy.src.services.admin_logic import build_dds_report, build_pnl_report


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


def _to_decimal_for_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _to_decimal_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimal_for_json(v) for v in value]
    return value


async def get_dds_report(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    date_from: str | None,
    date_to: str | None,
) -> dict[str, Any]:
    today = datetime.now(tz=timezone.utc).date()
    from_date = _parse_date_safe(date_from, default=today - timedelta(days=30))
    to_date = _parse_date_safe(date_to, default=today)
    start_dt, end_dt = _date_bounds(from_date, to_date)

    rows = await safe_fetch(
        conn,
        """
        SELECT happened_at, kind, category, amount_rub
        FROM finance_transactions
        WHERE user_id = $3
          AND happened_at >= $1
          AND happened_at < $2
        ORDER BY happened_at ASC
        """,
        start_dt,
        end_dt,
        user_id,
    )
    report = build_dds_report(rows_to_dicts(rows))
    report["date_from"] = from_date.isoformat()
    report["date_to"] = to_date.isoformat()
    return _to_decimal_for_json(report)


async def get_pnl_report(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    date_from: str | None,
    date_to: str | None,
    group_by: str,
) -> dict[str, Any]:
    today = datetime.now(tz=timezone.utc).date()
    from_date = _parse_date_safe(date_from, default=today - timedelta(days=30))
    to_date = _parse_date_safe(date_to, default=today)
    start_dt, end_dt = _date_bounds(from_date, to_date)

    sales_rows = await safe_fetch(
        conn,
        """
        SELECT so.sold_at, soi.revenue_rub, soi.cogs_rub, soi.fee_rub, soi.extra_cost_rub
        FROM sales_order_items soi
        JOIN sales_orders so ON so.id = soi.sales_order_id
        WHERE so.user_id = $3
          AND so.sold_at >= $1
          AND so.sold_at < $2
        ORDER BY so.sold_at ASC
        """,
        start_dt,
        end_dt,
        user_id,
    )
    op_expenses = await safe_fetch(
        conn,
        """
        SELECT happened_at, amount_rub
        FROM finance_transactions
        WHERE user_id = $3
          AND happened_at >= $1
          AND happened_at < $2
          AND kind = 'expense'
          AND category NOT IN ('purchase', 'marketplace_fee')
        ORDER BY happened_at ASC
        """,
        start_dt,
        end_dt,
        user_id,
    )

    report = build_pnl_report(
        sales_rows=rows_to_dicts(sales_rows),
        operating_expense_rows=rows_to_dicts(op_expenses),
        group_by=group_by,
    )
    report["date_from"] = from_date.isoformat()
    report["date_to"] = to_date.isoformat()
    return _to_decimal_for_json(report)
