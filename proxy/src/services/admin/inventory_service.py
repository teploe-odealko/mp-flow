from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import asyncpg
from fastapi import HTTPException
from proxy.src.repositories.admin import finance_repo, lot_repo, order_repo, stock_repo
from proxy.src.routes.admin.serialization import record_to_dict, rows_to_dicts
from proxy.src.services.admin.fifo_service import consume_fifo_lots, to_money, to_qty


async def create_initial_balance(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    received_at = datetime.now(tz=timezone.utc)
    order_number = f"IB-{received_at.strftime('%Y%m%d-%H%M%S-%f')}"

    order = await order_repo.create_order(
        conn,
        order_number=order_number,
        supplier_name="Начальный остаток",
        order_date=received_at.date(),
        expected_date=None,
        notes="Оприходование начальных остатков",
        shared_costs_json="[]",
        user_id=user_id,
    )
    if not order:
        raise HTTPException(status_code=500, detail="Failed to create initial balance order")

    await order_repo.set_order_received(conn, order_id=str(order["id"]), received_at=received_at)
    order_id = str(order["id"])

    total_purchase = Decimal("0.00")
    created_lots: list[dict[str, Any]] = []

    for entry in items:
        card_id = entry["master_card_id"]
        qty = to_qty(entry["quantity"])
        unit_cost = to_money(entry["unit_cost_rub"])
        line_total = to_money(unit_cost * qty)
        total_purchase += line_total

        card = await order_repo.get_card_for_balance(conn, card_id=card_id, user_id=user_id)
        if not card:
            raise HTTPException(status_code=404, detail=f"Master card {card_id} not found")

        item = await order_repo.insert_order_item_simple(
            conn,
            order_id=order_id,
            master_card_id=card_id,
            title=card["title"],
            quantity=qty,
            purchase_price_rub=line_total,
            unit_cost_rub=unit_cost,
        )

        lot = await lot_repo.create_lot(
            conn,
            master_card_id=card_id,
            supplier_order_item_id=str(item["id"]),
            received_at=received_at,
            quantity=qty,
            unit_cost_rub=unit_cost,
            metadata={"supplier_order_id": order_id, "type": "initial_balance"},
        )
        if lot:
            created_lots.append(record_to_dict(lot) or {})

        await stock_repo.update_warehouse_qty(conn, master_card_id=card_id, delta=qty)
        await stock_repo.create_stock_movement(
            conn,
            user_id=user_id,
            master_card_id=card_id,
            movement_type="initial_balance",
            quantity=qty,
            reference_type="supplier_order",
            reference_id=order_id,
        )

    await order_repo.update_order_total(
        conn, order_id=order_id, total_amount=to_money(total_purchase)
    )

    await finance_repo.insert_purchase_transaction(
        conn,
        happened_at=received_at,
        amount_rub=to_money(total_purchase),
        order_id=order_id,
        order_number=order_number,
        notes_prefix="Начальный остаток",
        payload={"supplier_order_id": order_id, "type": "initial_balance"},
        user_id=user_id,
    )

    order_updated = await order_repo.get_order(conn, order_id=order_id, user_id=user_id)
    return {
        "order": record_to_dict(order_updated),
        "lots_created": created_lots,
        "items_count": len(items),
        "purchase_amount_rub": float(to_money(total_purchase)),
    }


async def adjust_inventory(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    master_card_id: str,
    quantity_delta: Decimal,
    notes: str | None = None,
) -> dict[str, Any]:
    """Manual inventory adjustment. Positive = add stock, negative = remove stock (FIFO)."""
    from proxy.src.repositories.admin.base import safe_fetchone

    card = await safe_fetchone(
        conn,
        "SELECT id, title, warehouse_qty FROM master_cards WHERE id = $1 AND user_id = $2",
        master_card_id,
        user_id,
    )
    if not card:
        raise HTTPException(status_code=404, detail="Master card not found")

    delta = to_qty(quantity_delta)

    if delta > 0:
        # Add stock: create a new lot with weighted average cost
        avg_row = await safe_fetchone(
            conn,
            """
            SELECT COALESCE(
                SUM(remaining_qty * unit_cost_rub) / NULLIF(SUM(remaining_qty), 0),
                0
            ) AS avg_cost
            FROM inventory_lots
            WHERE master_card_id = $1 AND remaining_qty > 0
            """,
            master_card_id,
        )
        avg_cost = to_money(avg_row["avg_cost"]) if avg_row else Decimal("0.00")

        await lot_repo.create_lot(
            conn,
            master_card_id=master_card_id,
            supplier_order_item_id=master_card_id,  # self-ref for adjustments
            received_at=datetime.now(tz=timezone.utc),
            quantity=delta,
            unit_cost_rub=avg_cost,
            metadata={"type": "adjustment", "notes": notes},
        )
    else:
        # Remove stock: FIFO deduction from oldest lots (via shared helper)
        await consume_fifo_lots(conn, card_id=master_card_id, qty=abs(delta))

    await stock_repo.update_warehouse_qty(conn, master_card_id=master_card_id, delta=delta)
    await stock_repo.create_stock_movement(
        conn,
        user_id=user_id,
        master_card_id=master_card_id,
        movement_type="adjustment",
        quantity=delta,
        reference_type="manual",
        notes=notes,
    )

    updated_card = await safe_fetchone(
        conn,
        "SELECT warehouse_qty FROM master_cards WHERE id = $1",
        master_card_id,
    )
    return {
        "master_card_id": master_card_id,
        "quantity_delta": float(delta),
        "new_warehouse_qty": float(updated_card["warehouse_qty"]) if updated_card else 0,
    }


async def get_inventory_overview(conn: asyncpg.Connection, *, user_id: str) -> dict[str, Any]:
    summary_rows = await lot_repo.get_inventory_summary(conn, user_id=user_id)
    lot_rows = await lot_repo.get_active_lots(conn, user_id=user_id)

    total_stock_value = sum(
        (to_money(row["stock_value_rub"]) for row in summary_rows), start=Decimal("0.00")
    )
    return {
        "summary": rows_to_dicts(summary_rows),
        "lots": rows_to_dicts(lot_rows),
        "total_stock_value_rub": float(to_money(total_stock_value)),
    }
