from __future__ import annotations

from decimal import Decimal
from typing import Any

import asyncpg
from proxy.src.repositories.admin.base import safe_execute, safe_fetch, safe_fetchone


async def update_warehouse_qty(
    conn: asyncpg.Connection,
    *,
    master_card_id: str,
    delta: Decimal,
) -> None:
    await safe_execute(
        conn,
        "UPDATE master_cards SET warehouse_qty = warehouse_qty + $1 WHERE id = $2",
        delta,
        master_card_id,
    )


async def create_stock_movement(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    master_card_id: str,
    movement_type: str,
    quantity: Decimal,
    reference_type: str | None = None,
    reference_id: str | None = None,
    notes: str | None = None,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO stock_movements
            (user_id, master_card_id, movement_type, quantity,
             reference_type, reference_id, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        """,
        user_id,
        master_card_id,
        movement_type,
        quantity,
        reference_type,
        reference_id,
        notes,
    )


async def get_movements_for_card(
    conn: asyncpg.Connection,
    *,
    master_card_id: str,
    user_id: str,
    limit: int = 50,
) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        """
        SELECT * FROM stock_movements
        WHERE master_card_id = $1 AND user_id = $2
        ORDER BY created_at DESC
        LIMIT $3
        """,
        master_card_id,
        user_id,
        limit,
    )


async def set_supply_warehouse_deducted(
    conn: asyncpg.Connection,
    *,
    supply_id: str,
    deducted: bool,
) -> None:
    await safe_execute(
        conn,
        "UPDATE ozon_supplies SET warehouse_deducted = $1 WHERE id = $2",
        deducted,
        supply_id,
    )


async def get_pending_returns_by_card(
    conn: asyncpg.Connection,
    *,
    user_id: str,
) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        """
        SELECT master_card_id, COALESCE(SUM(quantity), 0) AS returns_qty
        FROM ozon_returns
        WHERE user_id = $1 AND resolution IS NULL AND master_card_id IS NOT NULL
        GROUP BY master_card_id
        """,
        user_id,
    )


async def upsert_ozon_return(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    ozon_return_id: int,
    posting_number: str | None,
    ozon_offer_id: str | None,
    ozon_sku: int | None,
    product_name: str | None,
    quantity: int,
    status: str | None,
    return_reason: str | None,
    is_opened: bool,
    logistic_return_date: Any | None,
    master_card_id: str | None,
    return_type: str = "",
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO ozon_returns (
            user_id, ozon_return_id, posting_number, ozon_offer_id,
            ozon_sku, product_name, quantity, status, return_reason,
            is_opened, logistic_return_date, master_card_id, return_type, synced_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        ON CONFLICT (user_id, ozon_return_id) DO UPDATE SET
            status = EXCLUDED.status,
            return_reason = EXCLUDED.return_reason,
            is_opened = EXCLUDED.is_opened,
            logistic_return_date = EXCLUDED.logistic_return_date,
            master_card_id = COALESCE(EXCLUDED.master_card_id, ozon_returns.master_card_id),
            return_type = EXCLUDED.return_type,
            synced_at = NOW()
        RETURNING *, (xmax = 0) AS is_insert
        """,
        user_id,
        ozon_return_id,
        posting_number,
        ozon_offer_id,
        ozon_sku,
        product_name,
        quantity,
        status,
        return_reason,
        is_opened,
        logistic_return_date,
        master_card_id,
        return_type,
    )
