from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import asyncpg
from proxy.src.repositories.admin.base import safe_fetch
from proxy.src.routes.admin.serialization import rows_to_dicts
from proxy.src.services.admin.utils import to_money


# ---------------------------------------------------------------------------
# Pure report builders (moved from admin_logic.py)
# ---------------------------------------------------------------------------


def _date_key(value: Any, group_by: str) -> str:
    if isinstance(value, datetime):
        dt_value = value
    elif isinstance(value, date):
        dt_value = datetime.combine(value, datetime.min.time())
    elif isinstance(value, str):
        try:
            dt_value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            dt_value = datetime.now(timezone.utc)
    else:
        dt_value = datetime.now(timezone.utc)

    if group_by == "month":
        return dt_value.strftime("%Y-%m")
    return dt_value.date().isoformat()


def build_dds_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Build cash flow (DDS) report."""
    per_day: dict[str, dict[str, Decimal]] = {}
    by_category: dict[str, dict[str, Decimal]] = {}

    total_income = Decimal("0.00")
    total_expense = Decimal("0.00")

    for row in rows:
        key = _date_key(row.get("happened_at"), group_by="day")
        kind = str(row.get("kind") or "").lower()
        category = str(row.get("category") or "other")
        amount = to_money(row.get("amount_rub"))

        per_day.setdefault(key, {"income": Decimal("0.00"), "expense": Decimal("0.00")})
        by_category.setdefault(category, {"income": Decimal("0.00"), "expense": Decimal("0.00")})

        if kind == "income":
            per_day[key]["income"] += amount
            by_category[category]["income"] += amount
            total_income += amount
        else:
            per_day[key]["expense"] += amount
            by_category[category]["expense"] += amount
            total_expense += amount

    rows_out = []
    for key in sorted(per_day.keys()):
        income = to_money(per_day[key]["income"])
        expense = to_money(per_day[key]["expense"])
        rows_out.append(
            {
                "date": key,
                "income_rub": income,
                "expense_rub": expense,
                "net_cashflow_rub": to_money(income - expense),
            }
        )

    categories_out = []
    for category, amounts in sorted(by_category.items(), key=lambda item: item[0]):
        income = to_money(amounts["income"])
        expense = to_money(amounts["expense"])
        categories_out.append(
            {
                "category": category,
                "income_rub": income,
                "expense_rub": expense,
                "net_rub": to_money(income - expense),
            }
        )

    return {
        "rows": rows_out,
        "by_category": categories_out,
        "totals": {
            "income_rub": to_money(total_income),
            "expense_rub": to_money(total_expense),
            "net_cashflow_rub": to_money(total_income - total_expense),
        },
    }


def build_pnl_report(
    *,
    sales_rows: list[dict[str, Any]],
    operating_expense_rows: list[dict[str, Any]],
    group_by: str = "day",
) -> dict[str, Any]:
    """Build PnL report grouped by day/month."""
    if group_by not in {"day", "month"}:
        raise ValueError("group_by must be one of: day, month")

    grouped: dict[str, dict[str, Decimal]] = {}
    for row in sales_rows:
        key = _date_key(row.get("sold_at"), group_by=group_by)
        metric = grouped.setdefault(
            key,
            {
                "revenue_rub": Decimal("0.00"),
                "cogs_rub": Decimal("0.00"),
                "fees_rub": Decimal("0.00"),
                "extra_cost_rub": Decimal("0.00"),
                "operating_expenses_rub": Decimal("0.00"),
            },
        )
        metric["revenue_rub"] += to_money(row.get("revenue_rub"))
        metric["cogs_rub"] += to_money(row.get("cogs_rub"))
        metric["fees_rub"] += to_money(row.get("fee_rub"))
        metric["extra_cost_rub"] += to_money(row.get("extra_cost_rub"))

    for row in operating_expense_rows:
        key = _date_key(row.get("happened_at"), group_by=group_by)
        metric = grouped.setdefault(
            key,
            {
                "revenue_rub": Decimal("0.00"),
                "cogs_rub": Decimal("0.00"),
                "fees_rub": Decimal("0.00"),
                "extra_cost_rub": Decimal("0.00"),
                "operating_expenses_rub": Decimal("0.00"),
            },
        )
        metric["operating_expenses_rub"] += to_money(row.get("amount_rub"))

    output_rows = []
    totals = {
        "revenue_rub": Decimal("0.00"),
        "cogs_rub": Decimal("0.00"),
        "fees_rub": Decimal("0.00"),
        "extra_cost_rub": Decimal("0.00"),
        "gross_profit_rub": Decimal("0.00"),
        "operating_expenses_rub": Decimal("0.00"),
        "net_profit_rub": Decimal("0.00"),
    }

    for key in sorted(grouped.keys()):
        metric = grouped[key]
        gross_profit = to_money(
            metric["revenue_rub"]
            - metric["cogs_rub"]
            - metric["fees_rub"]
            - metric["extra_cost_rub"]
        )
        net_profit = to_money(gross_profit - metric["operating_expenses_rub"])
        row = {
            "period": key,
            "revenue_rub": to_money(metric["revenue_rub"]),
            "cogs_rub": to_money(metric["cogs_rub"]),
            "fees_rub": to_money(metric["fees_rub"]),
            "extra_cost_rub": to_money(metric["extra_cost_rub"]),
            "gross_profit_rub": gross_profit,
            "operating_expenses_rub": to_money(metric["operating_expenses_rub"]),
            "net_profit_rub": net_profit,
        }
        output_rows.append(row)
        for field in totals:
            totals[field] += row[field]

    return {
        "group_by": group_by,
        "rows": output_rows,
        "totals": {key: to_money(value) for key, value in totals.items()},
    }


# ---------------------------------------------------------------------------
# Service functions (DB queries + report builders)
# ---------------------------------------------------------------------------


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
