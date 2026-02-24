from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.services.admin import report_service
from proxy.src.services.admin.pricing_service import calculate_pricing

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def reports_dds(date_from: str = "", date_to: str = "") -> str:
    """Cash flow report (DDS — Движение Денежных Средств).
    Groups transactions by category, calculates totals for income and expenses.

    Args:
        date_from: Start date YYYY-MM-DD (default 30 days ago).
        date_to: End date YYYY-MM-DD (default today).
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await report_service.get_dds_report(
            conn,
            user_id=deps.user_id,
            date_from=date_from or None,
            date_to=date_to or None,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def reports_pnl(date_from: str = "", date_to: str = "", group_by: str = "month") -> str:
    """Profit & Loss report from internal data.
    Revenue - COGS - marketplace fees - operating expenses = net profit.

    Args:
        date_from: Start date YYYY-MM-DD (default 30 days ago).
        date_to: End date YYYY-MM-DD (default today).
        group_by: Grouping period — 'day', 'week', or 'month' (default 'month').
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await report_service.get_pnl_report(
            conn,
            user_id=deps.user_id,
            date_from=date_from or None,
            date_to=date_to or None,
            group_by=group_by,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def reports_unit_economics(date_from: str = "", date_to: str = "") -> str:
    """Per-SKU unit economics from Ozon synced data.
    Revenue, commission, logistics, COGS, profit, margin per SKU.

    Args:
        date_from: Start date YYYY-MM-DD (default current month start).
        date_to: End date YYYY-MM-DD (default today).
    """
    from datetime import datetime, timedelta, timezone

    from proxy.src.repositories.admin.base import safe_fetch

    deps = get_deps()
    today = datetime.now(tz=timezone.utc).date()
    from_d = datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else today.replace(day=1)
    to_d = datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else today
    start_dt = datetime(from_d.year, from_d.month, from_d.day, tzinfo=timezone.utc)
    end_dt = datetime(to_d.year, to_d.month, to_d.day, tzinfo=timezone.utc) + timedelta(days=1)

    async with deps.pool.acquire() as conn:
        rows = await safe_fetch(
            conn,
            """
            SELECT
                sku, MAX(product_name) AS product_name,
                COUNT(*) AS operations_count,
                SUM(CASE WHEN finance_type = 'orders' OR (finance_type = '' AND revenue > 0)
                    THEN quantity ELSE 0 END) AS orders_qty,
                SUM(CASE WHEN operation_type = 'ClientReturnAgentOperation'
                    THEN quantity ELSE 0 END) AS returns_qty,
                SUM(revenue) AS total_revenue,
                SUM(sale_commission) AS total_commission,
                SUM(last_mile) AS total_last_mile,
                SUM(fulfillment) AS total_fulfillment,
                SUM(acquiring) AS total_acquiring,
                SUM(return_logistics) AS total_return_logistics,
                SUM(marketing) AS total_marketing,
                SUM(cogs) AS total_cogs
            FROM ozon_sku_economics
            WHERE user_id = $1 AND operation_date >= $2 AND operation_date < $3 AND sku != 0
            GROUP BY sku
            ORDER BY SUM(revenue) DESC
            """,
            deps.user_id,
            start_dt,
            end_dt,
        )

    items = []
    for row in rows:
        r = dict(row)
        revenue = float(r.get("total_revenue") or 0)
        costs = sum(
            float(r.get(f"total_{c}") or 0)
            for c in [
                "commission",
                "last_mile",
                "fulfillment",
                "acquiring",
                "return_logistics",
                "marketing",
            ]
        )
        cogs = float(r.get("total_cogs") or 0)
        profit = revenue + costs - cogs
        margin = round(profit / revenue * 100, 1) if revenue else 0
        items.append(
            {
                "sku": r["sku"],
                "product_name": r["product_name"] or "",
                "orders_qty": int(r.get("orders_qty") or 0),
                "returns_qty": int(r.get("returns_qty") or 0),
                "revenue": round(revenue, 2),
                "commission": round(float(r.get("total_commission") or 0), 2),
                "last_mile": round(float(r.get("total_last_mile") or 0), 2),
                "fulfillment": round(float(r.get("total_fulfillment") or 0), 2),
                "acquiring": round(float(r.get("total_acquiring") or 0), 2),
                "return_logistics": round(float(r.get("total_return_logistics") or 0), 2),
                "marketing": round(float(r.get("total_marketing") or 0), 2),
                "cogs": round(cogs, 2),
                "profit": round(profit, 2),
                "margin_pct": margin,
            }
        )

    return serialize_result(
        {
            "items": items,
            "date_from": from_d.isoformat(),
            "date_to": to_d.isoformat(),
        }
    )


@mcp.tool()
@mcp_error_handler
async def pricing_calculate(
    purchase_price_cny: float,
    cny_rate: float,
    quantity: int = 1,
    logistics_per_unit: float = 0,
    packaging_per_unit: float = 0,
    customs_per_unit: float = 0,
    extra_per_unit: float = 0,
    commission_pct: float = 0,
    acquiring_pct: float = 1.5,
    last_mile_rub: float = 0,
    storage_per_day_rub: float = 0,
    storage_days: int = 30,
    return_rate_pct: float = 0,
    return_logistics_rub: float = 0,
    usn_rate_pct: float = 7,
    sale_price_rub: float = 0,
    target_margin_pct: float = 0,
) -> str:
    """Full pricing calculator: from CNY purchase price to final RUB profit.

    Two modes:
    1. Forward: provide sale_price_rub → calculates margin and profit.
    2. Reverse: provide target_margin_pct → calculates required sale price.

    Args:
        purchase_price_cny: Purchase price per unit in CNY (required).
        cny_rate: CNY to RUB exchange rate (required).
        quantity: Batch size for per-batch calculations (default 1).
        logistics_per_unit: Logistics cost per unit in RUB.
        packaging_per_unit: Packaging cost per unit in RUB.
        customs_per_unit: Customs/duties per unit in RUB.
        extra_per_unit: Other costs per unit in RUB.
        commission_pct: Ozon commission as % of sale price.
        acquiring_pct: Acquiring fee as % of sale price (default 1.5%).
        last_mile_rub: Last mile delivery cost per unit in RUB.
        storage_per_day_rub: Daily storage cost per unit in RUB.
        storage_days: Expected storage duration in days (default 30).
        return_rate_pct: Expected return rate as % (e.g. 5 = 5%).
        return_logistics_rub: Return logistics cost per returned unit in RUB.
        usn_rate_pct: USN tax rate as % (default 7%).
        sale_price_rub: Sale price in RUB (for forward mode). 0 = not set.
        target_margin_pct: Target margin as % (for reverse mode). 0 = not set.
    """
    result = calculate_pricing(
        purchase_price_cny=purchase_price_cny,
        cny_rate=cny_rate,
        quantity=quantity,
        logistics_per_unit=logistics_per_unit,
        packaging_per_unit=packaging_per_unit,
        customs_per_unit=customs_per_unit,
        extra_per_unit=extra_per_unit,
        commission_pct=commission_pct,
        acquiring_pct=acquiring_pct,
        last_mile_rub=last_mile_rub,
        storage_per_day_rub=storage_per_day_rub,
        storage_days=storage_days,
        return_rate_pct=return_rate_pct,
        return_logistics_rub=return_logistics_rub,
        usn_rate_pct=usn_rate_pct,
        sale_price_rub=sale_price_rub if sale_price_rub else None,
        target_margin_pct=target_margin_pct if target_margin_pct else None,
    )
    return serialize_result(result)
