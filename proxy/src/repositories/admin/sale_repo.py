from __future__ import annotations

from decimal import Decimal
from typing import Any

import asyncpg
from proxy.src.repositories.admin.base import safe_execute, safe_fetch, safe_fetchone
from proxy.src.routes.admin.list_query import ListQuery, WhereBuilder

SALES_SORT_MAP = {
    "sold_at": "sold_at",
    "created_at": "created_at",
}


async def list_sales(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    lq: ListQuery,
    marketplace: str | None = None,
    status: str | None = None,
) -> tuple[list[asyncpg.Record], int]:
    wb = WhereBuilder()
    wb.exact("user_id", user_id)
    wb.exact_optional("marketplace", marketplace)
    wb.exact_optional("status", status)
    wb.ilike_multi(["external_order_id", "marketplace"], lq.q)

    where_sql, params = wb.build()

    total_row = await safe_fetchone(
        conn,
        f"SELECT COUNT(*) AS total FROM sales_orders {where_sql}",
        *params,
    )
    total = int(total_row["total"]) if total_row else 0

    sort_col = SALES_SORT_MAP[lq.sort_field]
    limit_idx = len(params) + 1
    offset_idx = len(params) + 2

    rows = await safe_fetch(
        conn,
        f"""
        SELECT *
        FROM sales_orders
        {where_sql}
        ORDER BY {sort_col} {lq.sort_dir}
        LIMIT ${limit_idx} OFFSET ${offset_idx}
        """,
        *params,
        lq.limit,
        lq.offset,
    )
    return rows, total


async def find_existing_order(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    marketplace: str,
    external_order_id: str,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        SELECT id FROM sales_orders
        WHERE user_id = $3 AND marketplace = $1 AND external_order_id = $2
        """,
        marketplace,
        external_order_id,
        user_id,
    )


async def get_order_with_items(
    conn: asyncpg.Connection, *, order_id: str
) -> tuple[asyncpg.Record | None, list[asyncpg.Record]]:
    order = await safe_fetchone(conn, "SELECT * FROM sales_orders WHERE id = $1", order_id)
    items = await safe_fetch(
        conn,
        "SELECT * FROM sales_order_items WHERE sales_order_id = $1 ORDER BY created_at ASC",
        order_id,
    )
    return order, items


async def create_order(
    conn: asyncpg.Connection,
    *,
    marketplace: str,
    external_order_id: str | None,
    sold_at: Any,
    status: str,
    raw_payload: str,
    user_id: str,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO sales_orders (
            marketplace, external_order_id, sold_at, status, raw_payload, user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        """,
        marketplace,
        external_order_id,
        sold_at,
        status,
        raw_payload,
        user_id,
    )


async def create_order_item(
    conn: asyncpg.Connection,
    *,
    sales_order_id: str,
    master_card_id: str,
    quantity: Decimal,
    unit_sale_price_rub: Decimal,
    revenue_rub: Decimal,
    fee_rub: Decimal,
    extra_cost_rub: Decimal,
    cogs_rub: Decimal,
    gross_profit_rub: Decimal,
    source_offer_id: str | None,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO sales_order_items (
            sales_order_id, master_card_id, quantity,
            unit_sale_price_rub, revenue_rub, fee_rub,
            extra_cost_rub, cogs_rub, gross_profit_rub, source_offer_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        """,
        sales_order_id,
        master_card_id,
        quantity,
        unit_sale_price_rub,
        revenue_rub,
        fee_rub,
        extra_cost_rub,
        cogs_rub,
        gross_profit_rub,
        source_offer_id,
    )


async def update_order_totals(
    conn: asyncpg.Connection,
    *,
    order_id: str,
    total_revenue: Decimal,
    total_fee: Decimal,
    total_cogs: Decimal,
    total_profit: Decimal,
) -> None:
    await safe_execute(
        conn,
        """
        UPDATE sales_orders
        SET total_revenue_rub = $2, total_fee_rub = $3,
            total_cogs_rub = $4, total_profit_rub = $5
        WHERE id = $1
        """,
        order_id,
        total_revenue,
        total_fee,
        total_cogs,
        total_profit,
    )


async def get_fifo_lots_for_card(conn: asyncpg.Connection, *, card_id: str) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        """
        SELECT id, remaining_qty, unit_cost_rub, received_at
        FROM inventory_lots
        WHERE master_card_id = $1 AND remaining_qty > 0
        ORDER BY received_at ASC, created_at ASC
        FOR UPDATE
        """,
        card_id,
    )


async def deduct_lot_qty(conn: asyncpg.Connection, *, lot_id: str, quantity: Decimal) -> None:
    await safe_execute(
        conn,
        "UPDATE inventory_lots SET remaining_qty = remaining_qty - $1 WHERE id = $2",
        quantity,
        lot_id,
    )


async def insert_fifo_allocation(
    conn: asyncpg.Connection,
    *,
    sales_order_item_id: str,
    inventory_lot_id: str,
    quantity: Decimal,
    unit_cost_rub: Decimal,
    total_cost_rub: Decimal,
) -> None:
    await safe_execute(
        conn,
        """
        INSERT INTO fifo_allocations (
            sales_order_item_id, inventory_lot_id,
            quantity, unit_cost_rub, total_cost_rub
        )
        VALUES ($1, $2, $3, $4, $5)
        """,
        sales_order_item_id,
        inventory_lot_id,
        quantity,
        unit_cost_rub,
        total_cost_rub,
    )


async def get_card_for_sale(
    conn: asyncpg.Connection, *, card_id: str, user_id: str
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        "SELECT id, title FROM master_cards WHERE id = $1 AND user_id = $2",
        card_id,
        user_id,
    )


async def insert_finance_transaction(
    conn: asyncpg.Connection,
    *,
    happened_at: Any,
    kind: str,
    category: str,
    amount_rub: Decimal,
    source: str,
    external_id: str,
    sales_order_id: str,
    notes: str,
    payload: str,
    user_id: str,
) -> None:
    await safe_execute(
        conn,
        """
        INSERT INTO finance_transactions (
            happened_at, kind, category, amount_rub, source,
            external_id, related_entity_type, related_entity_id,
            notes, payload, user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'sales_order', $7, $8, $9, $10)
        ON CONFLICT (source, external_id) DO NOTHING
        """,
        happened_at,
        kind,
        category,
        amount_rub,
        source,
        external_id,
        sales_order_id,
        notes,
        payload,
        user_id,
    )
