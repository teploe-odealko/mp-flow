from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import asyncpg
from proxy.src.repositories.admin.base import safe_execute, safe_fetch, safe_fetchone


async def create_lot(
    conn: asyncpg.Connection,
    *,
    master_card_id: str,
    supplier_order_item_id: str,
    received_at: Any,
    quantity: Decimal,
    unit_cost_rub: Decimal,
    metadata: dict[str, Any] | None = None,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO inventory_lots (
            master_card_id, supplier_order_item_id, received_at,
            initial_qty, remaining_qty, unit_cost_rub, metadata
        )
        VALUES ($1, $2, $3, $4, $4, $5, $6)
        RETURNING *
        """,
        master_card_id,
        supplier_order_item_id,
        received_at,
        quantity,
        unit_cost_rub,
        json.dumps(metadata or {}),
    )


async def delete_lots_for_order(conn: asyncpg.Connection, *, order_id: str, user_id: str) -> str:
    return await safe_execute(
        conn,
        """
        DELETE FROM inventory_lots
        WHERE supplier_order_item_id IN (
            SELECT soi.id
            FROM supplier_order_items soi
            JOIN supplier_orders so ON so.id = soi.supplier_order_id
            WHERE soi.supplier_order_id = $1
              AND so.user_id = $2
        )
        """,
        order_id,
        user_id,
    )


async def get_inventory_summary(conn: asyncpg.Connection, *, user_id: str) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        """
        SELECT
            mc.id AS master_card_id,
            mc.sku,
            mc.title,
            mc.ozon_offer_id,
            COALESCE(SUM(il.remaining_qty), 0) AS available_qty,
            COALESCE(SUM(il.remaining_qty * il.unit_cost_rub), 0) AS stock_value_rub
        FROM master_cards mc
        LEFT JOIN inventory_lots il ON il.master_card_id = mc.id
        WHERE mc.user_id = $1
        GROUP BY mc.id
        ORDER BY mc.title ASC
        """,
        user_id,
    )


async def get_active_lots(conn: asyncpg.Connection, *, user_id: str) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        """
        SELECT
            il.id,
            il.master_card_id,
            mc.title AS master_card_title,
            il.received_at,
            il.initial_qty,
            il.remaining_qty,
            il.unit_cost_rub,
            soi.supplier_order_id
        FROM inventory_lots il
        JOIN master_cards mc ON mc.id = il.master_card_id
        LEFT JOIN supplier_order_items soi ON soi.id = il.supplier_order_item_id
        WHERE mc.user_id = $1 AND il.remaining_qty > 0
        ORDER BY il.received_at ASC, il.created_at ASC
        """,
        user_id,
    )
