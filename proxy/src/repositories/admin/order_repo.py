from __future__ import annotations

from decimal import Decimal
from typing import Any

import asyncpg
from proxy.src.repositories.admin.base import safe_execute, safe_fetch, safe_fetchone
from proxy.src.routes.admin.list_query import ListQuery, WhereBuilder

ORDERS_SORT_MAP = {
    "created_at": "created_at",
    "order_date": "order_date",
    "supplier_name": "supplier_name",
}


async def list_orders(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    lq: ListQuery,
    status_filter: str | None,
) -> tuple[list[asyncpg.Record], int]:
    wb = WhereBuilder()
    wb.exact("user_id", user_id)
    wb.exact_optional("status", status_filter)
    wb.ilike_multi(["order_number", "supplier_name", "notes"], lq.q)

    where_sql, params = wb.build()

    total_row = await safe_fetchone(
        conn,
        f"SELECT COUNT(*) AS total FROM supplier_orders {where_sql}",
        *params,
    )
    total = int(total_row["total"]) if total_row else 0

    sort_col = ORDERS_SORT_MAP[lq.sort_field]
    limit_idx = len(params) + 1
    offset_idx = len(params) + 2

    rows = await safe_fetch(
        conn,
        f"""
        SELECT *
        FROM supplier_orders
        {where_sql}
        ORDER BY {sort_col} {lq.sort_dir}
        LIMIT ${limit_idx} OFFSET ${offset_idx}
        """,
        *params,
        lq.limit,
        lq.offset,
    )
    return rows, total


async def get_order(
    conn: asyncpg.Connection, *, order_id: str, user_id: str
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        "SELECT * FROM supplier_orders WHERE id = $1 AND user_id = $2",
        order_id,
        user_id,
    )


async def get_order_for_update(
    conn: asyncpg.Connection, *, order_id: str, user_id: str
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        "SELECT * FROM supplier_orders WHERE id = $1 AND user_id = $2 FOR UPDATE",
        order_id,
        user_id,
    )


async def get_order_items(
    conn: asyncpg.Connection, *, order_id: str, user_id: str
) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        """
        SELECT soi.*, mc.sku, mc.title AS master_card_title
        FROM supplier_order_items soi
        JOIN supplier_orders so ON so.id = soi.supplier_order_id
        LEFT JOIN master_cards mc ON mc.id = soi.master_card_id
        WHERE soi.supplier_order_id = $1
          AND so.user_id = $2
        ORDER BY created_at ASC
        """,
        order_id,
        user_id,
    )


async def get_order_items_raw(conn: asyncpg.Connection, *, order_id: str) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        "SELECT * FROM supplier_order_items WHERE supplier_order_id = $1 ORDER BY created_at ASC",
        order_id,
    )


async def create_order(
    conn: asyncpg.Connection,
    *,
    order_number: str,
    supplier_name: str,
    order_date: Any,
    expected_date: Any,
    notes: str | None,
    shared_costs_json: str,
    user_id: str,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO supplier_orders (
            order_number, supplier_name, status, currency,
            order_date, expected_date, notes, shared_costs, user_id
        )
        VALUES ($1, $2, 'draft', 'RUB', $3, $4, $5, $6::jsonb, $7)
        RETURNING *
        """,
        order_number,
        supplier_name,
        order_date,
        expected_date,
        notes,
        shared_costs_json,
        user_id,
    )


async def update_order_header(
    conn: asyncpg.Connection,
    *,
    order_id: str,
    supplier_name: str,
    order_date: Any,
    expected_date: Any,
    notes: str | None,
    shared_costs_json: str,
) -> None:
    await safe_execute(
        conn,
        """
        UPDATE supplier_orders
        SET supplier_name = $2, order_date = $3, expected_date = $4,
            notes = $5, shared_costs = $6::jsonb, updated_at = NOW()
        WHERE id = $1
        """,
        order_id,
        supplier_name,
        order_date,
        expected_date,
        notes,
        shared_costs_json,
    )


async def update_order_total(
    conn: asyncpg.Connection, *, order_id: str, total_amount: Decimal
) -> None:
    await safe_execute(
        conn,
        "UPDATE supplier_orders SET total_amount_rub = $2, updated_at = NOW() WHERE id = $1",
        order_id,
        total_amount,
    )


async def set_order_received(conn: asyncpg.Connection, *, order_id: str, received_at: Any) -> None:
    await safe_execute(
        conn,
        """
        UPDATE supplier_orders
        SET status = 'received', received_at = $2, updated_at = NOW()
        WHERE id = $1
        """,
        order_id,
        received_at,
    )


async def set_order_draft(conn: asyncpg.Connection, *, order_id: str) -> None:
    await safe_execute(
        conn,
        """
        UPDATE supplier_orders
        SET status = 'draft', received_at = NULL, updated_at = NOW()
        WHERE id = $1
        """,
        order_id,
    )


async def delete_order(conn: asyncpg.Connection, *, order_id: str, user_id: str) -> None:
    await safe_execute(
        conn,
        "DELETE FROM supplier_orders WHERE id = $1 AND user_id = $2",
        order_id,
        user_id,
    )


async def delete_order_items(conn: asyncpg.Connection, *, order_id: str) -> None:
    await safe_execute(
        conn,
        "DELETE FROM supplier_order_items WHERE supplier_order_id = $1",
        order_id,
    )


async def insert_order_item(
    conn: asyncpg.Connection,
    *,
    order_id: str,
    master_card_id: str | None,
    title: str,
    quantity: Decimal,
    cny_price_per_unit: Decimal,
    individual_cost_rub: Decimal,
    allocations_json: str,
    purchase_price_rub: Decimal,
    packaging_cost_rub: Decimal,
    logistics_cost_rub: Decimal,
    customs_cost_rub: Decimal,
    extra_cost_rub: Decimal,
    unit_cost_rub: Decimal,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO supplier_order_items (
            supplier_order_id, master_card_id, title, quantity,
            cny_price_per_unit, individual_cost_rub, allocations,
            purchase_price_rub, packaging_cost_rub, logistics_cost_rub,
            customs_cost_rub, extra_cost_rub, unit_cost_rub
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
        RETURNING *
        """,
        order_id,
        master_card_id,
        title,
        quantity,
        cny_price_per_unit,
        individual_cost_rub,
        allocations_json,
        purchase_price_rub,
        packaging_cost_rub,
        logistics_cost_rub,
        customs_cost_rub,
        extra_cost_rub,
        unit_cost_rub,
    )


async def update_item_received(
    conn: asyncpg.Connection,
    *,
    item_id: str,
    received_qty: Decimal,
    original_unit_cost: Decimal,
    new_unit_cost: Decimal,
) -> None:
    await safe_execute(
        conn,
        """
        UPDATE supplier_order_items
        SET received_qty = $2, original_unit_cost_rub = $3, unit_cost_rub = $4
        WHERE id = $1
        """,
        item_id,
        received_qty,
        original_unit_cost,
        new_unit_cost,
    )


async def reset_items_received(conn: asyncpg.Connection, *, order_id: str) -> None:
    await safe_execute(
        conn,
        """
        UPDATE supplier_order_items
        SET received_qty = NULL,
            unit_cost_rub = COALESCE(original_unit_cost_rub, unit_cost_rub),
            original_unit_cost_rub = NULL
        WHERE supplier_order_id = $1
        """,
        order_id,
    )


async def get_card_title(conn: asyncpg.Connection, *, card_id: str, user_id: str) -> str | None:
    row = await safe_fetchone(
        conn,
        "SELECT title FROM master_cards WHERE id = $1 AND user_id = $2",
        card_id,
        user_id,
    )
    return str(row["title"]) if row else None


async def get_card_for_balance(
    conn: asyncpg.Connection, *, card_id: str, user_id: str
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        "SELECT id, title FROM master_cards WHERE id = $1 AND user_id = $2",
        card_id,
        user_id,
    )


async def insert_order_item_simple(
    conn: asyncpg.Connection,
    *,
    order_id: str,
    master_card_id: str,
    title: str,
    quantity: Decimal,
    purchase_price_rub: Decimal,
    unit_cost_rub: Decimal,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO supplier_order_items (
            supplier_order_id, master_card_id, title, quantity,
            purchase_price_rub, unit_cost_rub, received_qty
        )
        VALUES ($1, $2, $3, $4, $5, $6, $4)
        RETURNING *
        """,
        order_id,
        master_card_id,
        title,
        quantity,
        purchase_price_rub,
        unit_cost_rub,
    )
