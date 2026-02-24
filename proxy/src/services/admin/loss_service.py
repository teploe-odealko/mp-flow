from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import asyncpg
from fastapi import HTTPException
from proxy.src.repositories.admin import finance_repo, stock_repo
from proxy.src.repositories.admin.base import safe_execute, safe_fetch
from proxy.src.services.admin.fifo_service import consume_fifo_lots, to_money, to_qty


async def write_off_supply_loss(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    master_card_id: str,
) -> dict[str, Any]:
    """Write off supply losses for a master card: FIFO deduct + expense transaction."""

    # 1. Find unwritten-off supply items with quantity_rejected > 0
    items = await safe_fetch(
        conn,
        """
        SELECT osi.id, osi.quantity_rejected, osi.quantity_planned,
               os.supply_number, os.ozon_supply_order_id
        FROM ozon_supply_items osi
        JOIN ozon_supplies os ON os.id = osi.ozon_supply_id
        WHERE osi.master_card_id = $1
          AND os.user_id = $2
          AND osi.quantity_rejected > 0
          AND NOT osi.loss_written_off
        """,
        master_card_id,
        user_id,
    )
    if not items:
        raise HTTPException(status_code=400, detail="No unwritten supply losses for this card")

    total_loss_qty = sum(int(item["quantity_rejected"]) for item in items)

    # 2. FIFO deduction from oldest lots (via shared helper)
    total_loss_cost, deduction_detail = await consume_fifo_lots(
        conn, card_id=master_card_id, qty=to_qty(total_loss_qty)
    )

    # 3. Create finance transaction (expense: supply_loss)
    now = datetime.now(tz=timezone.utc)
    item_ids = [str(item["id"]) for item in items]
    supply_numbers = list({item["supply_number"] or "—" for item in items})

    await finance_repo.create_transaction(
        conn,
        happened_at=now,
        kind="expense",
        category="supply_loss",
        subcategory=None,
        amount_rub=to_money(total_loss_cost),
        source="ozon_supply_loss",
        external_id=f"loss:{master_card_id}:{now.strftime('%Y%m%d%H%M%S')}",
        related_entity_type="master_card",
        related_entity_id=master_card_id,
        notes=f"Потери при поставке на Ozon: {total_loss_qty} шт ({', '.join(supply_numbers)})",
        payload_json=json.dumps(
            {
                "master_card_id": master_card_id,
                "total_loss_qty": total_loss_qty,
                "supply_item_ids": item_ids,
                "deduction_detail": deduction_detail,
            }
        ),
        user_id=user_id,
    )

    # 4. Mark supply items as written off
    await safe_execute(
        conn,
        "UPDATE ozon_supply_items SET loss_written_off = TRUE WHERE id = ANY($1::uuid[])",
        item_ids,
    )

    # 5. Informational stock movement (warehouse_qty already deducted on shipment)
    await stock_repo.create_stock_movement(
        conn,
        user_id=user_id,
        master_card_id=master_card_id,
        movement_type="supply_loss_writeoff",
        quantity=Decimal(0),
        reference_type="ozon_supply_loss",
        notes=f"Списано {total_loss_qty} шт потерь при поставке ({', '.join(supply_numbers)})",
    )

    return {
        "written_off_qty": total_loss_qty,
        "loss_cost_rub": float(to_money(total_loss_cost)),
        "items_affected": len(items),
        "supply_numbers": supply_numbers,
    }


async def write_off_discrepancy(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    master_card_id: str,
    quantity: int,
    notes: str | None = None,
) -> dict[str, Any]:
    """Write off inventory discrepancy: FIFO deduct + expense transaction."""
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity must be > 0")

    # 1. FIFO deduction
    total_cost, deduction_detail = await consume_fifo_lots(
        conn, card_id=master_card_id, qty=to_qty(quantity)
    )

    # 2. Finance transaction
    now = datetime.now(tz=timezone.utc)
    await finance_repo.create_transaction(
        conn,
        happened_at=now,
        kind="expense",
        category="inventory_loss",
        subcategory=None,
        amount_rub=to_money(total_cost),
        source="discrepancy_writeoff",
        external_id=f"disc:{master_card_id}:{now.strftime('%Y%m%d%H%M%S')}",
        related_entity_type="master_card",
        related_entity_id=master_card_id,
        notes=notes or f"Списание расхождений: {quantity} шт",
        payload_json=json.dumps(
            {
                "master_card_id": master_card_id,
                "quantity": quantity,
                "deduction_detail": deduction_detail,
            }
        ),
        user_id=user_id,
    )

    # 3. Informational stock movement
    await stock_repo.create_stock_movement(
        conn,
        user_id=user_id,
        master_card_id=master_card_id,
        movement_type="discrepancy_writeoff",
        quantity=Decimal(0),
        reference_type="discrepancy",
        notes=f"Списано {quantity} шт расхождений",
    )

    return {
        "written_off_qty": quantity,
        "loss_cost_rub": float(to_money(total_cost)),
    }
