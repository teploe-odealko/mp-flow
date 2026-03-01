"""FIFO inventory management — single source of truth for lot operations.

This module centralises all FIFO-related helpers so that every caller
(sales_service, loss_service, inventory_service, ozon_sync, reports)
uses the same canonical algorithm and queries.

Rules:
  1. remaining_qty on inventory_lots is the only FIFO truth.
  2. All sales MUST go through create_sale() → allocate_fifo().
  3. Loss write-offs and adjustments use consume_fifo_lots().
  4. Cancellations reverse via reverse_fifo_allocations().
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable

import asyncpg
from proxy.src.services.admin.utils import EPSILON, QTY_QUANT, to_money, to_qty

__all__ = [
    "FifoLot",
    "FifoAllocation",
    "InsufficientInventoryError",
    "allocate_fifo",
    "allocate_fifo_partial",
    "calculate_purchase_unit_cost",
    "calculate_sale_metrics",
    "to_money",
    "to_qty",
    "consume_fifo_lots",
    "reverse_fifo_allocations",
    "get_sku_card_mapping",
    "get_offer_card_mapping",
    "get_lots_by_card",
]

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class FifoLot:
    """Inventory lot used for FIFO allocation."""

    lot_id: str
    remaining_qty: Decimal
    unit_cost_rub: Decimal
    received_at: datetime | None = None


@dataclass(slots=True)
class FifoAllocation:
    """Concrete sale allocation against a lot."""

    lot_id: str
    quantity: Decimal
    unit_cost_rub: Decimal
    total_cost_rub: Decimal


class InsufficientInventoryError(ValueError):
    """Raised when FIFO allocation cannot satisfy requested quantity."""

    def __init__(self, requested_qty: Decimal, allocated_qty: Decimal):
        self.requested_qty = requested_qty
        self.allocated_qty = allocated_qty
        self.shortage_qty = (requested_qty - allocated_qty).quantize(
            QTY_QUANT, rounding=ROUND_HALF_UP
        )
        super().__init__(
            "Insufficient inventory: requested={requested} allocated={allocated} shortage={shortage}".format(
                requested=requested_qty,
                allocated=allocated_qty,
                shortage=self.shortage_qty,
            )
        )


# ---------------------------------------------------------------------------
# Core FIFO allocation algorithm
# ---------------------------------------------------------------------------


def allocate_fifo(lots: Iterable[FifoLot], requested_qty: Decimal) -> list[FifoAllocation]:
    """
    Allocate quantity from lots using FIFO order.

    Args:
        lots: available lots sorted (or unsorted)
        requested_qty: quantity to allocate

    Returns:
        Allocations list.

    Raises:
        InsufficientInventoryError: if stock is not enough.
    """
    need = to_qty(requested_qty)
    if need <= 0:
        return []

    sorted_lots = sorted(
        lots,
        key=lambda lot: (
            lot.received_at or datetime.min,
            lot.lot_id,
        ),
    )

    allocations: list[FifoAllocation] = []
    allocated = Decimal("0.000")
    for lot in sorted_lots:
        remaining = to_qty(lot.remaining_qty)
        if remaining <= EPSILON:
            continue
        if need <= EPSILON:
            break

        take = min(remaining, need).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)
        if take <= EPSILON:
            continue

        unit_cost = to_money(lot.unit_cost_rub)
        total_cost = to_money(take * unit_cost)
        allocations.append(
            FifoAllocation(
                lot_id=lot.lot_id,
                quantity=take,
                unit_cost_rub=unit_cost,
                total_cost_rub=total_cost,
            )
        )
        allocated += take
        need = (need - take).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)

    if need > EPSILON:
        raise InsufficientInventoryError(
            requested_qty=to_qty(requested_qty), allocated_qty=allocated
        )

    return allocations


# ---------------------------------------------------------------------------
# Partial FIFO allocation (for sync — never raises on insufficient stock)
# ---------------------------------------------------------------------------


def allocate_fifo_partial(lots: list[FifoLot], requested_qty: Decimal) -> list[FifoAllocation]:
    """Like allocate_fifo() but never raises InsufficientInventoryError.

    Allocates as much as possible from available lots.  If stock is
    insufficient the returned allocations cover only part of the request.
    """
    try:
        return allocate_fifo(lots, requested_qty)
    except InsufficientInventoryError:
        pass

    # Fallback: allocate everything available
    need = to_qty(requested_qty)
    if need <= 0:
        return []

    sorted_lots = sorted(
        lots,
        key=lambda lot: (lot.received_at or datetime.min, lot.lot_id),
    )

    allocations: list[FifoAllocation] = []
    for lot in sorted_lots:
        remaining = to_qty(lot.remaining_qty)
        if remaining <= EPSILON or need <= EPSILON:
            continue
        take = min(remaining, need)
        unit_cost = to_money(lot.unit_cost_rub)
        total_cost = to_money(take * unit_cost)
        allocations.append(
            FifoAllocation(
                lot_id=lot.lot_id,
                quantity=take,
                unit_cost_rub=unit_cost,
                total_cost_rub=total_cost,
            )
        )
        need = to_qty(need - take)
    return allocations


# ---------------------------------------------------------------------------
# Cost calculation helpers
# ---------------------------------------------------------------------------


def calculate_purchase_unit_cost(
    *,
    quantity: Any,
    purchase_price_rub: Any,
    packaging_cost_rub: Any = 0,
    logistics_cost_rub: Any = 0,
    customs_cost_rub: Any = 0,
    extra_cost_rub: Any = 0,
) -> Decimal:
    """Compute unit cost for supplier-order line."""
    qty = to_qty(quantity)
    if qty <= 0:
        raise ValueError("quantity must be > 0")

    total = (
        to_money(purchase_price_rub)
        + to_money(packaging_cost_rub)
        + to_money(logistics_cost_rub)
        + to_money(customs_cost_rub)
        + to_money(extra_cost_rub)
    )
    return to_money(total / qty)


def calculate_sale_metrics(
    *,
    quantity: Any,
    unit_sale_price_rub: Any,
    fee_rub: Any = 0,
    extra_cost_rub: Any = 0,
    allocations: Iterable[FifoAllocation],
) -> dict[str, Decimal]:
    """Calculate revenue, COGS and profit for a sale line."""
    qty = to_qty(quantity)
    revenue = to_money(qty * to_money(unit_sale_price_rub))
    fee = to_money(fee_rub)
    extra = to_money(extra_cost_rub)
    cogs = to_money(sum((a.total_cost_rub for a in allocations), start=Decimal("0.00")))
    gross_profit = to_money(revenue - cogs - fee - extra)
    return {
        "revenue_rub": revenue,
        "fee_rub": fee,
        "extra_cost_rub": extra,
        "cogs_rub": cogs,
        "gross_profit_rub": gross_profit,
    }


# ---------------------------------------------------------------------------
# Simple FIFO deduction (no allocation records — for losses / adjustments)
# ---------------------------------------------------------------------------


async def consume_fifo_lots(
    conn: asyncpg.Connection,
    *,
    card_id: str,
    qty: Decimal,
    for_update: bool = True,
) -> tuple[Decimal, list[dict[str, Any]]]:
    """Deduct *qty* from the oldest lots of *card_id* (FIFO order).

    Does NOT create fifo_allocations — only updates remaining_qty.
    Used by loss_service and inventory_service.

    Returns (total_cost, deductions_list).
    """
    lock = "FOR UPDATE" if for_update else ""
    lots = await conn.fetch(
        f"""
        SELECT id, remaining_qty, unit_cost_rub
        FROM inventory_lots
        WHERE master_card_id = $1 AND remaining_qty > 0
        ORDER BY received_at ASC, created_at ASC
        {lock}
        """,
        card_id,
    )

    total_cost = Decimal("0.00")
    deductions: list[dict[str, Any]] = []
    remaining = to_qty(qty)

    for lot in lots:
        if remaining <= EPSILON:
            break
        lot_qty = to_qty(lot["remaining_qty"])
        unit_cost = to_money(lot["unit_cost_rub"])
        take = min(remaining, lot_qty)
        cost = to_money(take * unit_cost)

        new_remaining = to_qty(lot_qty - take)
        await conn.execute(
            "UPDATE inventory_lots SET remaining_qty = $1 WHERE id = $2",
            new_remaining,
            lot["id"],
        )

        total_cost += cost
        deductions.append(
            {"lot_id": str(lot["id"]), "qty": float(take), "unit_cost": float(unit_cost)}
        )
        remaining = to_qty(remaining - take)

    return total_cost, deductions


# ---------------------------------------------------------------------------
# FIFO reversal (for cancelled sales)
# ---------------------------------------------------------------------------


async def reverse_fifo_allocations(
    conn: asyncpg.Connection,
    *,
    sales_order_id: str,
) -> int:
    """Reverse all FIFO allocations for a cancelled sales order.

    Returns remaining_qty back to inventory_lots, deletes fifo_allocations,
    and zeros out cogs on the sale items.

    Returns the number of allocations reversed.
    """
    allocs = await conn.fetch(
        """
        SELECT fa.id, fa.inventory_lot_id, fa.quantity
        FROM fifo_allocations fa
        JOIN sales_order_items soi ON soi.id = fa.sales_order_item_id
        WHERE soi.sales_order_id = $1
        """,
        sales_order_id,
    )

    if not allocs:
        return 0

    for a in allocs:
        await conn.execute(
            "UPDATE inventory_lots SET remaining_qty = remaining_qty + $1 WHERE id = $2",
            a["quantity"],
            a["inventory_lot_id"],
        )

    alloc_ids = [a["id"] for a in allocs]
    await conn.execute(
        "DELETE FROM fifo_allocations WHERE id = ANY($1::uuid[])",
        alloc_ids,
    )

    await conn.execute(
        """
        UPDATE sales_order_items
        SET cogs_rub = 0, gross_profit_rub = 0
        WHERE sales_order_id = $1
        """,
        sales_order_id,
    )

    await conn.execute(
        """
        UPDATE sales_orders
        SET total_cogs_rub = 0, total_profit_rub = 0
        WHERE id = $1
        """,
        sales_order_id,
    )

    logger.info(
        "Reversed %d FIFO allocations for cancelled order %s",
        len(allocs),
        sales_order_id,
    )
    return len(allocs)


# ---------------------------------------------------------------------------
# Shared SKU→card mapping queries (eliminates 5 duplicate CTEs)
# ---------------------------------------------------------------------------


async def get_sku_card_mapping(conn: asyncpg.Connection, *, user_id: str) -> dict[int, str]:
    """Map Ozon FBO SKU (int) → master_card_id (str).

    Reads the JSONB ``attributes->'sources'`` to find the first
    ``ozon:*`` source with a numeric ``sku`` field.
    """
    rows = await conn.fetch(
        """
        SELECT mc.id AS master_card_id,
               (SELECT v->'data'->>'sku'
                FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                WHERE k LIKE 'ozon:%'
                  AND v->'data'->>'sku' IS NOT NULL
                  AND v->'data'->>'sku' ~ '^[0-9]+$'
                LIMIT 1)::bigint AS fbo_sku
        FROM master_cards mc
        WHERE mc.user_id = $1
        """,
        user_id,
    )
    return {int(r["fbo_sku"]): str(r["master_card_id"]) for r in rows if r["fbo_sku"] is not None}


async def get_offer_card_mapping(conn: asyncpg.Connection, *, user_id: str) -> dict[str, str]:
    """Map Ozon offer_id (str) → master_card_id (str).

    Uses ozon_offer_id column on master_cards (primary mapping).
    """
    rows = await conn.fetch(
        """
        SELECT id AS master_card_id, ozon_offer_id
        FROM master_cards
        WHERE user_id = $1 AND ozon_offer_id IS NOT NULL AND ozon_offer_id != ''
        """,
        user_id,
    )
    return {r["ozon_offer_id"]: str(r["master_card_id"]) for r in rows}


async def get_lots_by_card(
    conn: asyncpg.Connection, *, user_id: str
) -> dict[str, list[dict[str, Any]]]:
    """Get all active inventory lots grouped by master_card_id.

    Used by reports and enrichment to compute FIFO COGS without
    mutating the lots.
    """
    rows = await conn.fetch(
        """
        SELECT il.master_card_id, il.id AS lot_id,
               il.initial_qty, il.remaining_qty, il.unit_cost_rub, il.received_at
        FROM inventory_lots il
        JOIN master_cards mc ON mc.id = il.master_card_id
        WHERE mc.user_id = $1 AND il.remaining_qty > 0
        ORDER BY il.master_card_id, il.received_at ASC, il.created_at ASC
        """,
        user_id,
    )
    result: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        card_id = str(r["master_card_id"])
        result.setdefault(card_id, []).append(dict(r))
    return result
