from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import asyncpg
from fastapi import HTTPException
from proxy.src.repositories.admin import sale_repo
from proxy.src.routes.admin.list_query import ListQuery, list_response
from proxy.src.routes.admin.serialization import record_to_dict, rows_to_dicts
from proxy.src.services.admin.fifo_service import (
    FifoLot,
    InsufficientInventoryError,
    allocate_fifo,
    allocate_fifo_partial,
    calculate_sale_metrics,
    to_money,
    to_qty,
)


def _to_decimal_for_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _to_decimal_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimal_for_json(v) for v in value]
    return value


def _build_sale_external_id(
    marketplace: str | None, external_order_id: str | None
) -> tuple[str, str | None]:
    mp = (marketplace or "manual").strip().lower()
    ext_id = (external_order_id or "").strip() or None
    return mp, ext_id


async def list_sales(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    lq: ListQuery,
    marketplace: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    rows, total = await sale_repo.list_sales(
        conn, user_id=user_id, lq=lq, marketplace=marketplace, status=status
    )
    return list_response(rows_to_dicts(rows), total, lq)


async def create_sale(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    marketplace: str | None,
    external_order_id: str | None,
    sold_at: datetime | None,
    status: str,
    items: list[dict[str, Any]],
    raw_payload: dict[str, Any],
    source: str = "manual",
    record_finance_transactions: bool = True,
    allow_insufficient: bool = False,
) -> dict[str, Any]:
    mp, ext_id = _build_sale_external_id(marketplace, external_order_id)
    effective_sold_at = sold_at or datetime.now(tz=timezone.utc)

    if ext_id:
        existing = await sale_repo.find_existing_order(
            conn, user_id=user_id, marketplace=mp, external_order_id=ext_id
        )
        if existing:
            existing_id = str(existing["id"])
            order, order_items = await sale_repo.get_order_with_items(conn, order_id=existing_id)
            return {
                "existing": True,
                "order": record_to_dict(order),
                "items": rows_to_dicts(order_items),
            }

    order_row = await sale_repo.create_order(
        conn,
        marketplace=mp,
        external_order_id=ext_id,
        sold_at=effective_sold_at,
        status=status,
        raw_payload=json.dumps(_to_decimal_for_json(raw_payload)),
        user_id=user_id,
    )
    if not order_row:
        raise HTTPException(status_code=500, detail="Failed to create sales order")

    sales_order_id = str(order_row["id"])

    total_revenue = Decimal("0.00")
    total_fee = Decimal("0.00")
    total_cogs = Decimal("0.00")
    total_profit = Decimal("0.00")

    created_items: list[dict[str, Any]] = []
    for item in items:
        card_id = item["master_card_id"]
        card_row = await sale_repo.get_card_for_sale(conn, card_id=card_id, user_id=user_id)
        if not card_row:
            if allow_insufficient:
                lot_rows = []
                lots = []
                allocations = []
                # Skip FIFO — card not found, record sale with zero COGS
                metrics = calculate_sale_metrics(
                    quantity=item["quantity"],
                    unit_sale_price_rub=item["unit_sale_price_rub"],
                    fee_rub=item.get("fee_rub", 0),
                    extra_cost_rub=item.get("extra_cost_rub", 0),
                    allocations=[],
                )
                total_revenue += metrics["revenue_rub"]
                total_fee += metrics["fee_rub"]
                total_cogs += metrics["cogs_rub"]
                total_profit += metrics["gross_profit_rub"]

                sale_item_row = await sale_repo.create_order_item(
                    conn,
                    sales_order_id=sales_order_id,
                    master_card_id=card_id,
                    quantity=to_qty(item["quantity"]),
                    unit_sale_price_rub=to_money(item["unit_sale_price_rub"]),
                    revenue_rub=metrics["revenue_rub"],
                    fee_rub=metrics["fee_rub"],
                    extra_cost_rub=metrics["extra_cost_rub"],
                    cogs_rub=metrics["cogs_rub"],
                    gross_profit_rub=metrics["gross_profit_rub"],
                    source_offer_id=item.get("source_offer_id"),
                )
                if sale_item_row:
                    created_items.append(record_to_dict(sale_item_row) or {})
                continue
            raise HTTPException(status_code=404, detail=f"Master card not found: {card_id}")

        lot_rows = await sale_repo.get_fifo_lots_for_card(conn, card_id=card_id)
        lots = [
            FifoLot(
                lot_id=str(row["id"]),
                remaining_qty=to_qty(row["remaining_qty"]),
                unit_cost_rub=to_money(row["unit_cost_rub"]),
                received_at=row["received_at"],
            )
            for row in lot_rows
        ]

        try:
            allocations = allocate_fifo(lots, to_qty(item["quantity"]))
        except InsufficientInventoryError as exc:
            if not allow_insufficient:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Insufficient inventory for {card_row['title']}: "
                        f"need {exc.requested_qty}, allocated {exc.allocated_qty}, "
                        f"shortage {exc.shortage_qty}"
                    ),
                ) from exc
            allocations = allocate_fifo_partial(lots, to_qty(item["quantity"]))

        metrics = calculate_sale_metrics(
            quantity=item["quantity"],
            unit_sale_price_rub=item["unit_sale_price_rub"],
            fee_rub=item.get("fee_rub", 0),
            extra_cost_rub=item.get("extra_cost_rub", 0),
            allocations=allocations,
        )
        total_revenue += metrics["revenue_rub"]
        total_fee += metrics["fee_rub"]
        total_cogs += metrics["cogs_rub"]
        total_profit += metrics["gross_profit_rub"]

        sale_item_row = await sale_repo.create_order_item(
            conn,
            sales_order_id=sales_order_id,
            master_card_id=card_id,
            quantity=to_qty(item["quantity"]),
            unit_sale_price_rub=to_money(item["unit_sale_price_rub"]),
            revenue_rub=metrics["revenue_rub"],
            fee_rub=metrics["fee_rub"],
            extra_cost_rub=metrics["extra_cost_rub"],
            cogs_rub=metrics["cogs_rub"],
            gross_profit_rub=metrics["gross_profit_rub"],
            source_offer_id=item.get("source_offer_id"),
        )
        if not sale_item_row:
            raise HTTPException(status_code=500, detail="Failed to create sales order item")
        sale_item_id = str(sale_item_row["id"])

        for alloc in allocations:
            await sale_repo.deduct_lot_qty(conn, lot_id=alloc.lot_id, quantity=alloc.quantity)
            await sale_repo.insert_fifo_allocation(
                conn,
                sales_order_item_id=sale_item_id,
                inventory_lot_id=alloc.lot_id,
                quantity=alloc.quantity,
                unit_cost_rub=alloc.unit_cost_rub,
                total_cost_rub=alloc.total_cost_rub,
            )

        item_out = record_to_dict(sale_item_row) or {}
        item_out["allocations"] = [asdict(a) for a in allocations]
        created_items.append(item_out)

    await sale_repo.update_order_totals(
        conn,
        order_id=sales_order_id,
        total_revenue=to_money(total_revenue),
        total_fee=to_money(total_fee),
        total_cogs=to_money(total_cogs),
        total_profit=to_money(total_profit),
    )

    if record_finance_transactions:
        await sale_repo.insert_finance_transaction(
            conn,
            happened_at=effective_sold_at,
            kind="income",
            category="sales_income",
            amount_rub=to_money(total_revenue),
            source=source,
            external_id=f"{mp}:{ext_id or sales_order_id}:income",
            sales_order_id=sales_order_id,
            notes=f"Sales order {ext_id or sales_order_id}",
            payload=json.dumps({"marketplace": mp, "sales_order_id": sales_order_id}),
            user_id=user_id,
        )
        if total_fee > 0:
            await sale_repo.insert_finance_transaction(
                conn,
                happened_at=effective_sold_at,
                kind="expense",
                category="marketplace_fee",
                amount_rub=to_money(total_fee),
                source=source,
                external_id=f"{mp}:{ext_id or sales_order_id}:fee",
                sales_order_id=sales_order_id,
                notes=f"Marketplace fee {ext_id or sales_order_id}",
                payload=json.dumps({"marketplace": mp, "sales_order_id": sales_order_id}),
                user_id=user_id,
            )

    order_updated = await sale_repo.get_order_with_items(conn, order_id=sales_order_id)
    return {
        "existing": False,
        "order": record_to_dict(order_updated[0]),
        "items": created_items,
    }
