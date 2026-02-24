from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import asyncpg
from fastapi import HTTPException
from proxy.src.repositories.admin import finance_repo, lot_repo, order_repo, stock_repo
from proxy.src.routes.admin.list_query import ListQuery, list_response
from proxy.src.routes.admin.serialization import record_to_dict, rows_to_dicts
from proxy.src.services.admin_logic import calculate_purchase_unit_cost, to_money, to_qty


async def list_orders(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    lq: ListQuery,
    status_filter: str | None,
) -> dict[str, Any]:
    rows, total = await order_repo.list_orders(
        conn, user_id=user_id, lq=lq, status_filter=status_filter
    )
    return list_response(rows_to_dicts(rows), total, lq)


async def get_order_detail(
    conn: asyncpg.Connection, *, order_id: str, user_id: str
) -> dict[str, Any]:
    order = await order_repo.get_order(conn, order_id=order_id, user_id=user_id)
    if not order:
        raise HTTPException(status_code=404, detail="Supplier order not found")
    items = await order_repo.get_order_items(conn, order_id=order_id, user_id=user_id)
    return {"order": record_to_dict(order), "items": rows_to_dicts(items)}


async def create_order(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    order_number: str | None,
    supplier_name: str,
    order_date: date | None,
    expected_date: date | None,
    notes: str | None,
    shared_costs: list[dict[str, Any]],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    effective_number = (
        order_number or f"SO-{datetime.now(tz=timezone.utc).strftime('%Y%m%d-%H%M%S-%f')}"
    )
    shared_costs_json = json.dumps(shared_costs) if shared_costs else "[]"

    order = await order_repo.create_order(
        conn,
        order_number=effective_number,
        supplier_name=supplier_name,
        order_date=order_date or date.today(),
        expected_date=expected_date,
        notes=notes,
        shared_costs_json=shared_costs_json,
        user_id=user_id,
    )
    if not order:
        raise HTTPException(status_code=500, detail="Failed to create supplier order")

    order_id = str(order["id"])
    created_items, total_amount = await _insert_order_items(conn, order_id, items, user_id)

    await order_repo.update_order_total(
        conn, order_id=order_id, total_amount=to_money(total_amount)
    )
    order_updated = await order_repo.get_order(conn, order_id=order_id, user_id=user_id)
    return {"order": record_to_dict(order_updated), "items": created_items}


async def update_order(
    conn: asyncpg.Connection,
    *,
    order_id: str,
    user_id: str,
    supplier_name: str,
    order_date: date | None,
    expected_date: date | None,
    notes: str | None,
    shared_costs: list[dict[str, Any]],
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    order = await order_repo.get_order_for_update(conn, order_id=order_id, user_id=user_id)
    if not order:
        raise HTTPException(status_code=404, detail="Supplier order not found")
    if order["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only draft orders can be edited")

    shared_costs_json = json.dumps(shared_costs) if shared_costs else "[]"

    await order_repo.update_order_header(
        conn,
        order_id=order_id,
        supplier_name=supplier_name,
        order_date=order_date or date.today(),
        expected_date=expected_date,
        notes=notes,
        shared_costs_json=shared_costs_json,
    )
    await order_repo.delete_order_items(conn, order_id=order_id)
    created_items, total_amount = await _insert_order_items(conn, order_id, items, user_id)

    await order_repo.update_order_total(
        conn, order_id=order_id, total_amount=to_money(total_amount)
    )
    order_updated = await order_repo.get_order(conn, order_id=order_id, user_id=user_id)
    return {"order": record_to_dict(order_updated), "items": created_items}


async def delete_order(conn: asyncpg.Connection, *, order_id: str, user_id: str) -> dict[str, Any]:
    order = await order_repo.get_order(conn, order_id=order_id, user_id=user_id)
    if not order:
        raise HTTPException(status_code=404, detail="Supplier order not found")
    if order["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only draft orders can be deleted")
    await order_repo.delete_order(conn, order_id=order_id, user_id=user_id)
    return {"deleted": True, "order_number": order["order_number"]}


async def receive_order(
    conn: asyncpg.Connection,
    *,
    order_id: str,
    user_id: str,
    recv_map: dict[str, Decimal] | None = None,
) -> dict[str, Any]:
    received_at = datetime.now(tz=timezone.utc)
    recv = recv_map or {}

    order = await order_repo.get_order_for_update(conn, order_id=order_id, user_id=user_id)
    if not order:
        raise HTTPException(status_code=404, detail="Supplier order not found")
    if order["status"] == "received":
        raise HTTPException(status_code=409, detail="Supplier order already received")

    items = await order_repo.get_order_items_raw(conn, order_id=order_id)
    if not items:
        raise HTTPException(status_code=400, detail="Supplier order has no items")

    total_purchase = Decimal("0.00")
    created_lots: list[dict[str, Any]] = []

    for item in items:
        if not item["master_card_id"]:
            continue
        item_id = str(item["id"])
        ordered_qty = to_qty(item["quantity"])

        individual = to_money(item.get("individual_cost_rub") or 0)
        purchase = to_money(item.get("purchase_price_rub") or 0)
        original_unit_cost = (
            to_money((purchase + individual) / ordered_qty) if ordered_qty > 0 else Decimal("0")
        )
        original_line_total = to_money(original_unit_cost * ordered_qty)
        total_purchase += original_line_total

        received_qty = to_qty(recv.get(item_id, ordered_qty))
        new_unit_cost = (
            to_money(original_line_total / received_qty) if received_qty > 0 else Decimal("0.00")
        )

        await order_repo.update_item_received(
            conn,
            item_id=item_id,
            received_qty=received_qty,
            original_unit_cost=original_unit_cost,
            new_unit_cost=new_unit_cost,
        )

        if received_qty > 0:
            lot = await lot_repo.create_lot(
                conn,
                master_card_id=item["master_card_id"],
                supplier_order_item_id=item_id,
                received_at=received_at,
                quantity=received_qty,
                unit_cost_rub=new_unit_cost,
                metadata={"supplier_order_id": order_id},
            )
            if lot:
                created_lots.append(record_to_dict(lot) or {})

            card_id = str(item["master_card_id"])
            await stock_repo.update_warehouse_qty(conn, master_card_id=card_id, delta=received_qty)
            await stock_repo.create_stock_movement(
                conn,
                user_id=user_id,
                master_card_id=card_id,
                movement_type="supplier_receipt",
                quantity=received_qty,
                reference_type="supplier_order",
                reference_id=order_id,
            )

    await order_repo.set_order_received(conn, order_id=order_id, received_at=received_at)

    await finance_repo.insert_purchase_transaction(
        conn,
        happened_at=received_at,
        amount_rub=to_money(total_purchase),
        order_id=order_id,
        order_number=order["order_number"],
        notes_prefix="Supplier order received",
        payload={"supplier_order_id": order_id},
        user_id=user_id,
    )

    order_updated = await order_repo.get_order(conn, order_id=order_id, user_id=user_id)
    return {
        "order": record_to_dict(order_updated),
        "lots_created": created_lots,
        "purchase_amount_rub": float(to_money(total_purchase)),
    }


async def unreceive_order(
    conn: asyncpg.Connection, *, order_id: str, user_id: str
) -> dict[str, Any]:
    order = await order_repo.get_order_for_update(conn, order_id=order_id, user_id=user_id)
    if not order:
        raise HTTPException(status_code=404, detail="Supplier order not found")
    if order["status"] != "received":
        raise HTTPException(status_code=409, detail="Order is not in received status")

    items = await order_repo.get_order_items_raw(conn, order_id=order_id)
    for item in items:
        if not item["master_card_id"]:
            continue
        received_qty = to_qty(item.get("received_qty") or item["quantity"])
        if received_qty > 0:
            card_id = str(item["master_card_id"])
            await stock_repo.update_warehouse_qty(conn, master_card_id=card_id, delta=-received_qty)
            await stock_repo.create_stock_movement(
                conn,
                user_id=user_id,
                master_card_id=card_id,
                movement_type="unreceive",
                quantity=-received_qty,
                reference_type="supplier_order",
                reference_id=order_id,
            )

    lots_deleted_result = await lot_repo.delete_lots_for_order(
        conn, order_id=order_id, user_id=user_id
    )
    await finance_repo.delete_purchase_transaction(conn, order_id=order_id, user_id=user_id)
    await order_repo.reset_items_received(conn, order_id=order_id)
    await order_repo.set_order_draft(conn, order_id=order_id)

    lots_count = 0
    if lots_deleted_result:
        try:
            lots_count = int(str(lots_deleted_result).split()[-1])
        except (ValueError, IndexError):
            pass

    return {"unreceived": True, "lots_deleted": lots_count}


# ---- Helpers ----


async def _insert_order_items(
    conn: asyncpg.Connection,
    order_id: str,
    items: list[dict[str, Any]],
    user_id: str,
) -> tuple[list[dict[str, Any]], Decimal]:
    total_amount = Decimal("0.00")
    created_items: list[dict[str, Any]] = []

    for item in items:
        master_card_id = item.get("master_card_id")
        title = item.get("title")
        if master_card_id and not title:
            title = await order_repo.get_card_title(conn, card_id=master_card_id, user_id=user_id)
        if not title:
            title = "Позиция заказа"

        quantity = item["quantity"]
        unit_cost = calculate_purchase_unit_cost(
            quantity=quantity,
            purchase_price_rub=item.get("purchase_price_rub", 0),
            packaging_cost_rub=item.get("packaging_cost_rub", 0),
            logistics_cost_rub=item.get("logistics_cost_rub", 0),
            customs_cost_rub=item.get("customs_cost_rub", 0),
            extra_cost_rub=item.get("extra_cost_rub", 0),
        )
        line_total = to_money(unit_cost * to_qty(quantity))
        total_amount += line_total

        allocations = item.get("allocations", [])
        allocations_json = json.dumps(allocations) if allocations else "[]"

        row = await order_repo.insert_order_item(
            conn,
            order_id=order_id,
            master_card_id=master_card_id,
            title=title,
            quantity=to_qty(quantity),
            cny_price_per_unit=to_money(item.get("cny_price_per_unit", 0)),
            individual_cost_rub=to_money(item.get("individual_cost_rub", 0)),
            allocations_json=allocations_json,
            purchase_price_rub=to_money(item.get("purchase_price_rub", 0)),
            packaging_cost_rub=to_money(item.get("packaging_cost_rub", 0)),
            logistics_cost_rub=to_money(item.get("logistics_cost_rub", 0)),
            customs_cost_rub=to_money(item.get("customs_cost_rub", 0)),
            extra_cost_rub=to_money(item.get("extra_cost_rub", 0)),
            unit_cost_rub=unit_cost,
        )
        if row:
            created_items.append(record_to_dict(row) or {})

    return created_items, total_amount
