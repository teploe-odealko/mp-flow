from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.list_query import ListQuery, WhereBuilder, list_query_dep, list_response
from proxy.src.routes.admin.response_models import (
    AcceptanceUpdateResponse,
    LogisticsMatrixResponse,
    SkuDetailResponse,
    SuppliesListResponse,
    WriteOffResponse,
)
from proxy.src.routes.admin_helpers import (
    _record_to_dict,
    _safe_execute,
    _safe_fetch,
    _safe_fetchone,
)
from proxy.src.services.admin.loss_service import write_off_discrepancy, write_off_supply_loss
from proxy.src.services.admin_logic import build_supply_chain_matrix

router = APIRouter(tags=["Logistics"])


@router.get("/logistics/matrix", response_model=LogisticsMatrixResponse)
async def get_logistics_matrix(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Build the supply chain matrix: one row per SKU with lifecycle columns."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        user_id = str(admin["id"])

        lot_count = await _safe_fetchone(
            conn,
            "SELECT COUNT(*) AS cnt FROM inventory_lots il JOIN master_cards mc ON mc.id = il.master_card_id WHERE mc.user_id = $1",
            user_id,
        )
        has_lots = lot_count and int(lot_count["cnt"]) > 0

        cards_rows = await _safe_fetch(
            conn,
            "SELECT id, sku, title, warehouse_qty FROM master_cards WHERE user_id = $1 AND status != 'archived'",
            user_id,
        )
        cards = [_record_to_dict(r) or {} for r in cards_rows]
        if not cards:
            return {"items": [], "total": 0, "needs_initial_balance": not has_lots}

        card_ids = [str(c["id"]) for c in cards]

        # 1. Supplier order aggregates
        order_rows = await _safe_fetch(
            conn,
            """
            SELECT soi.master_card_id::text AS cid,
                   COALESCE(SUM(soi.quantity), 0) AS ordered,
                   COALESCE(SUM(soi.received_qty), 0) AS received
            FROM supplier_order_items soi
            JOIN supplier_orders so ON so.id = soi.supplier_order_id
            WHERE soi.master_card_id = ANY($1::uuid[])
              AND so.user_id = $2
            GROUP BY soi.master_card_id
            """,
            card_ids,
            user_id,
        )
        order_agg: dict[str, dict[str, Any]] = {}
        for r in order_rows:
            order_agg[r["cid"]] = {
                "ordered": float(r["ordered"] or 0),
                "received": float(r["received"] or 0),
            }

        # 2. Supply total (shipped to Ozon — exclude cancelled/rejected/draft)
        supply_rows = await _safe_fetch(
            conn,
            """
            SELECT osi.master_card_id::text AS cid,
                   COALESCE(SUM(osi.quantity_planned), 0) AS shipped
            FROM ozon_supply_items osi
            JOIN ozon_supplies os ON os.id = osi.ozon_supply_id
            WHERE osi.master_card_id = ANY($1::uuid[])
              AND os.user_id = $2
              AND os.status NOT IN ('CANCELLED', 'REJECTED_AT_SUPPLY_WAREHOUSE', 'DRAFT')
            GROUP BY osi.master_card_id
            """,
            card_ids,
            user_id,
        )
        supply_total_agg: dict[str, float] = {}
        for r in supply_rows:
            supply_total_agg[r["cid"]] = float(r["shipped"] or 0)

        # 3. Ozon warehouse stock (latest snapshot)
        stock_rows = await _safe_fetch(
            conn,
            """
            SELECT ws.master_card_id::text AS cid,
                   COALESCE(SUM(ws.free_to_sell), 0) AS ozon_stock
            FROM ozon_warehouse_stock ws
            WHERE ws.user_id = $1
              AND ws.master_card_id = ANY($2::uuid[])
              AND ws.snapshot_at = (
                  SELECT MAX(snapshot_at) FROM ozon_warehouse_stock WHERE user_id = $1
              )
            GROUP BY ws.master_card_id
            """,
            user_id,
            card_ids,
        )
        stock_agg: dict[str, float] = {}
        for r in stock_rows:
            stock_agg[r["cid"]] = float(r["ozon_stock"] or 0)

        # 4. FBO postings aggregates (all statuses)
        postings_rows = await _safe_fetch(
            conn,
            """
            SELECT soi.master_card_id::text AS cid,
                   COALESCE(SUM(soi.quantity), 0) AS total_qty,
                   COALESCE(SUM(soi.quantity) FILTER (
                       WHERE so.status = 'cancelled'), 0) AS cancelled_qty,
                   COALESCE(SUM(soi.quantity) FILTER (
                       WHERE so.status = 'delivered'), 0) AS delivered_gross
            FROM sales_order_items soi
            JOIN sales_orders so ON so.id = soi.sales_order_id
            WHERE soi.master_card_id = ANY($1::uuid[])
              AND so.user_id = $2
              AND so.marketplace = 'ozon'
            GROUP BY soi.master_card_id
            """,
            card_ids,
            user_id,
        )
        postings_agg: dict[str, dict[str, Any]] = {}
        for r in postings_rows:
            postings_agg[r["cid"]] = {
                "total_qty": int(r["total_qty"]),
                "cancelled_qty": int(r["cancelled_qty"]),
                "delivered_gross": int(r["delivered_gross"]),
            }

        # 5. Returns (customer returns for "Выкуплено" + in-transit for "Едет на склад")
        returns_rows = await _safe_fetch(
            conn,
            """
            SELECT master_card_id::text AS cid,
                   COALESCE(SUM(quantity) FILTER (
                       WHERE return_type != 'Cancellation'), 0) AS customer_returns,
                   COALESCE(SUM(quantity) FILTER (
                       WHERE status NOT IN ('ReturnedToOzon', 'ReturnedToSeller',
                                            'Disposed', 'Utilized')), 0) AS in_transit
            FROM ozon_returns
            WHERE user_id = $1
              AND master_card_id = ANY($2::uuid[])
            GROUP BY master_card_id
            """,
            user_id,
            card_ids,
        )
        returns_agg: dict[str, dict[str, Any]] = {}
        for r in returns_rows:
            returns_agg[r["cid"]] = {
                "customer_returns": int(r["customer_returns"]),
                "in_transit": int(r["in_transit"]),
            }

        matrix = build_supply_chain_matrix(
            cards=cards,
            order_agg=order_agg,
            supply_total_agg=supply_total_agg,
            stock_agg=stock_agg,
            postings_agg=postings_agg,
            returns_agg=returns_agg,
        )

        return {
            "items": matrix,
            "total": len(matrix),
            "needs_initial_balance": not has_lots,
        }


@router.post("/logistics/write-off-loss", response_model=WriteOffResponse)
async def write_off_loss(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Write off supply losses for a master card: FIFO deduct + expense."""
    pool = get_db_pool(request)
    body = await request.json()
    master_card_id = body.get("master_card_id")
    if not master_card_id:
        raise HTTPException(status_code=400, detail="master_card_id is required")

    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await write_off_supply_loss(
                conn, user_id=str(admin["id"]), master_card_id=master_card_id
            )
    return result


@router.post("/logistics/write-off-discrepancy", response_model=WriteOffResponse)
async def write_off_disc(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Write off inventory discrepancy: FIFO deduct + expense."""
    pool = get_db_pool(request)
    body = await request.json()
    master_card_id = body.get("master_card_id")
    quantity = body.get("quantity")
    notes = body.get("notes")
    if not master_card_id:
        raise HTTPException(status_code=400, detail="master_card_id is required")
    if not quantity or int(quantity) <= 0:
        raise HTTPException(status_code=400, detail="quantity must be > 0")

    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await write_off_discrepancy(
                conn,
                user_id=str(admin["id"]),
                master_card_id=master_card_id,
                quantity=int(quantity),
                notes=notes,
            )
    return result


@router.post("/logistics/update-acceptance", response_model=AcceptanceUpdateResponse)
async def update_acceptance(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Update acceptance data for a supply item (manual entry)."""
    pool = get_db_pool(request)
    body = await request.json()
    item_id = body.get("item_id")
    accepted = body.get("quantity_accepted")
    if not item_id or accepted is None:
        raise HTTPException(status_code=400, detail="item_id and quantity_accepted required")

    accepted = int(accepted)
    if accepted < 0:
        raise HTTPException(status_code=400, detail="quantity_accepted must be >= 0")

    async with pool.acquire() as conn:
        # Verify item belongs to this user
        row = await _safe_fetchone(
            conn,
            """
            SELECT osi.id, osi.quantity_planned, os.user_id
            FROM ozon_supply_items osi
            JOIN ozon_supplies os ON os.id = osi.ozon_supply_id
            WHERE osi.id = $1
            """,
            item_id,
        )
        if not row or str(row["user_id"]) != str(admin["id"]):
            raise HTTPException(status_code=404, detail="Supply item not found")

        planned = int(row["quantity_planned"])
        if accepted > planned:
            raise HTTPException(
                status_code=400, detail=f"accepted ({accepted}) > planned ({planned})"
            )

        rejected = planned - accepted
        await _safe_execute(
            conn,
            """
            UPDATE ozon_supply_items
            SET quantity_accepted = $1, quantity_rejected = $2
            WHERE id = $3
            """,
            accepted,
            rejected,
            item_id,
        )

    return {"item_id": str(item_id), "quantity_accepted": accepted, "quantity_rejected": rejected}


SUPPLIES_SORT_FIELDS = {"created_ozon_at", "synced_at"}


@router.get("/logistics/supplies", response_model=SuppliesListResponse)
async def get_logistics_supplies(
    request: Request,
    lq: ListQuery = Depends(
        list_query_dep(
            allowed_sort=SUPPLIES_SORT_FIELDS,
            default_sort="created_ozon_at:desc",
            default_limit=50,
        )
    ),
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """List Ozon supply orders with items, grouped by supply. Supports search & pagination."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        user_id = str(admin["id"])

        wb = WhereBuilder()
        wb.exact("os.user_id", user_id)
        wb.ilike_multi(["os.supply_number", "os.warehouse_name"], lq.q)

        where_sql, params = wb.build()

        # Count
        total_row = await _safe_fetchone(
            conn,
            f"SELECT COUNT(*) AS total FROM ozon_supplies os {where_sql}",
            *params,
        )
        total = int(total_row["total"]) if total_row else 0

        # Data
        sort_map = {"created_ozon_at": "os.created_ozon_at", "synced_at": "os.synced_at"}
        sort_col = sort_map[lq.sort_field]
        limit_idx = len(params) + 1
        offset_idx = len(params) + 2

        supply_rows = await _safe_fetch(
            conn,
            f"""
            SELECT os.id, os.ozon_supply_order_id, os.supply_number,
                   os.status, os.warehouse_name, os.warehouse_id,
                   os.created_ozon_at, os.updated_ozon_at,
                   os.total_items_planned, os.total_items_accepted,
                   os.synced_at
            FROM ozon_supplies os
            {where_sql}
            ORDER BY {sort_col} {lq.sort_dir} NULLS LAST
            LIMIT ${limit_idx} OFFSET ${offset_idx}
            """,
            *params,
            lq.limit,
            lq.offset,
        )

        supply_ids = [s["id"] for s in supply_rows]
        items_by_supply: dict[str, list[dict[str, Any]]] = {}
        if supply_ids:
            all_item_rows = await _safe_fetch(
                conn,
                """
                SELECT osi.ozon_supply_id::text AS supply_id,
                       osi.ozon_offer_id, osi.product_name, osi.ozon_sku,
                       osi.quantity_planned, osi.quantity_accepted, osi.quantity_rejected,
                       mc.sku AS card_sku, mc.id::text AS master_card_id
                FROM ozon_supply_items osi
                JOIN ozon_supplies os ON os.id = osi.ozon_supply_id
                LEFT JOIN master_cards mc ON mc.id = osi.master_card_id
                WHERE osi.ozon_supply_id = ANY($1::uuid[])
                  AND os.user_id = $2
                ORDER BY osi.ozon_supply_id, osi.product_name
                """,
                supply_ids,
                user_id,
            )
            for row in all_item_rows:
                supply_id = str(row["supply_id"])
                items_by_supply.setdefault(supply_id, []).append(
                    {
                        "offer_id": row["ozon_offer_id"],
                        "product_name": row["product_name"],
                        "card_sku": row["card_sku"],
                        "master_card_id": row["master_card_id"],
                        "planned": int(row["quantity_planned"] or 0),
                        "accepted": int(row["quantity_accepted"] or 0),
                        "rejected": int(row["quantity_rejected"] or 0),
                    }
                )

        supplies = []
        for s in supply_rows:
            supply_id = str(s["id"])
            items = items_by_supply.get(supply_id, [])
            total_planned = sum(item["planned"] for item in items)
            total_accepted = sum(item["accepted"] for item in items)
            total_rejected = sum(item["rejected"] for item in items)
            has_discrepancy = total_rejected > 0 or (
                total_accepted > 0 and total_accepted != total_planned
            )

            supplies.append(
                {
                    "id": supply_id,
                    "supply_order_id": s["ozon_supply_order_id"],
                    "supply_number": s["supply_number"],
                    "status": s["status"],
                    "warehouse_name": s["warehouse_name"],
                    "created_at": s["created_ozon_at"].isoformat()
                    if s["created_ozon_at"]
                    else None,
                    "updated_at": s["updated_ozon_at"].isoformat()
                    if s["updated_ozon_at"]
                    else None,
                    "total_planned": total_planned,
                    "total_accepted": total_accepted,
                    "total_rejected": total_rejected,
                    "has_discrepancy": has_discrepancy,
                    "items": items,
                }
            )

        return list_response(supplies, total, lq)


@router.get("/logistics/sku/{master_card_id}", response_model=SkuDetailResponse)
async def get_logistics_sku_detail(
    master_card_id: str,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Drill-down: full lifecycle detail for one SKU."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        uid = str(admin["id"])
        card = await _safe_fetchone(
            conn,
            "SELECT id, sku, title, ozon_offer_id, ozon_product_id FROM master_cards WHERE id = $1 AND user_id = $2",
            master_card_id,
            uid,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Master card not found")

        so_rows = await _safe_fetch(
            conn,
            """
            SELECT so.order_number, so.order_date, so.status AS order_status,
                   soi.quantity, soi.received_qty, soi.unit_cost_rub
            FROM supplier_order_items soi
            JOIN supplier_orders so ON so.id = soi.supplier_order_id
            WHERE soi.master_card_id = $1
              AND so.user_id = $2
            ORDER BY so.order_date DESC
            """,
            master_card_id,
            uid,
        )
        supplier_orders = [
            {
                "order_number": r["order_number"],
                "order_date": str(r["order_date"]) if r["order_date"] else None,
                "status": r["order_status"],
                "quantity": float(r["quantity"]) if r["quantity"] else 0,
                "received_qty": float(r["received_qty"]) if r["received_qty"] else None,
                "unit_cost_rub": float(r["unit_cost_rub"]) if r["unit_cost_rub"] else 0,
            }
            for r in so_rows
        ]

        os_rows = await _safe_fetch(
            conn,
            """
            SELECT osi.id::text AS item_id,
                   os.supply_number, os.status, os.warehouse_name,
                   os.created_ozon_at,
                   osi.quantity_planned, osi.quantity_accepted, osi.quantity_rejected
            FROM ozon_supply_items osi
            JOIN ozon_supplies os ON os.id = osi.ozon_supply_id
            WHERE osi.master_card_id = $1
              AND os.user_id = $2
            ORDER BY os.created_ozon_at DESC
            """,
            master_card_id,
            uid,
        )
        ozon_supplies = [
            {
                "item_id": r["item_id"],
                "supply_number": r["supply_number"],
                "status": r["status"],
                "warehouse_name": r["warehouse_name"],
                "created_ozon_at": r["created_ozon_at"].isoformat()
                if r["created_ozon_at"]
                else None,
                "quantity_planned": r["quantity_planned"],
                "quantity_accepted": r["quantity_accepted"],
                "quantity_rejected": r["quantity_rejected"],
            }
            for r in os_rows
        ]

        user_id = str(admin["id"])
        stock_rows = await _safe_fetch(
            conn,
            """
            SELECT warehouse_name, stock_type, present, reserved, free_to_sell, snapshot_at
            FROM ozon_warehouse_stock
            WHERE user_id = $1 AND master_card_id = $2
              AND snapshot_at = (SELECT MAX(snapshot_at) FROM ozon_warehouse_stock WHERE user_id = $1)
            ORDER BY warehouse_name
            """,
            user_id,
            master_card_id,
        )
        stock_snapshots = [
            {
                "warehouse_name": r["warehouse_name"],
                "stock_type": r["stock_type"],
                "present": r["present"],
                "reserved": r["reserved"],
                "free_to_sell": r["free_to_sell"],
                "snapshot_at": r["snapshot_at"].isoformat() if r["snapshot_at"] else None,
            }
            for r in stock_rows
        ]

        lot_rows = await _safe_fetch(
            conn,
            """
            SELECT received_at, initial_qty, remaining_qty, unit_cost_rub
            FROM inventory_lots il
            JOIN master_cards mc ON mc.id = il.master_card_id
            WHERE il.master_card_id = $1
              AND mc.user_id = $2
            ORDER BY received_at
            """,
            master_card_id,
            uid,
        )
        inventory_lots = [
            {
                "received_at": r["received_at"].isoformat() if r["received_at"] else None,
                "initial_qty": float(r["initial_qty"]),
                "remaining_qty": float(r["remaining_qty"]),
                "unit_cost_rub": float(r["unit_cost_rub"]),
            }
            for r in lot_rows
        ]

        fbo_sku_row = await _safe_fetchone(
            conn,
            """
            SELECT (SELECT v->'data'->>'sku'
                    FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                    WHERE k LIKE 'ozon:%%'
                      AND v->'data'->>'sku' IS NOT NULL
                      AND v->'data'->>'sku' ~ '^[0-9]+$'
                    LIMIT 1)::bigint AS fbo_sku
            FROM master_cards mc WHERE mc.id = $1 AND mc.user_id = $2
            """,
            master_card_id,
            uid,
        )
        fbo_sku = fbo_sku_row["fbo_sku"] if fbo_sku_row and fbo_sku_row["fbo_sku"] else None

        recent_sales: list[dict[str, Any]] = []
        if fbo_sku:
            sale_rows = await _safe_fetch(
                conn,
                """
                SELECT operation_date, quantity, revenue, posting_number
                FROM ozon_sku_economics
                WHERE user_id = $1 AND sku = $2
                  AND operation_type = 'OperationAgentDeliveredToCustomer'
                ORDER BY operation_date DESC
                LIMIT 50
                """,
                user_id,
                fbo_sku,
            )
            recent_sales = [
                {
                    "sold_at": r["operation_date"].isoformat() if r["operation_date"] else None,
                    "quantity": int(r["quantity"]),
                    "revenue_rub": float(r["revenue"]) if r["revenue"] else 0,
                    "posting_number": r["posting_number"],
                }
                for r in sale_rows
            ]

        recv_loss = sum(
            max(0, (o["quantity"] or 0) - (o["received_qty"] or o["quantity"] or 0))
            for o in supplier_orders
        )
        ozon_loss = sum(s["quantity_rejected"] or 0 for s in ozon_supplies)
        total_loss = recv_loss + ozon_loss

        avg_cost = 0.0
        if inventory_lots:
            total_qty = sum(lot["remaining_qty"] for lot in inventory_lots)
            if total_qty > 0:
                avg_cost = (
                    sum(lot["remaining_qty"] * lot["unit_cost_rub"] for lot in inventory_lots)
                    / total_qty
                )

        loss_details: list[dict[str, Any]] = []
        if recv_loss > 0:
            for o in supplier_orders:
                d = max(0, (o["quantity"] or 0) - (o["received_qty"] or o["quantity"] or 0))
                if d > 0:
                    loss_details.append(
                        {
                            "source": f"Заказ {o['order_number']}",
                            "qty": d,
                            "cost_rub": round(d * avg_cost, 2),
                        }
                    )
        if ozon_loss > 0:
            for s in ozon_supplies:
                if s["quantity_rejected"] and s["quantity_rejected"] > 0:
                    loss_details.append(
                        {
                            "source": f"Поставка {s['supply_number'] or '—'} → {s['warehouse_name'] or '—'}",
                            "qty": s["quantity_rejected"],
                            "cost_rub": round(s["quantity_rejected"] * avg_cost, 2),
                        }
                    )

        return {
            "card": {
                "id": str(card["id"]),
                "sku": card["sku"],
                "title": card["title"],
            },
            "supplier_orders": supplier_orders,
            "ozon_supplies": ozon_supplies,
            "stock_snapshots": stock_snapshots,
            "inventory_lots": inventory_lots,
            "recent_sales": recent_sales,
            "losses": {
                "total_qty": total_loss,
                "total_cost_rub": round(total_loss * avg_cost, 2),
                "details": loss_details,
            },
        }
