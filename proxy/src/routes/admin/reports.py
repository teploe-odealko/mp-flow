from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.response_models import (
    DdsReportResponse,
    PnlOzonResponse,
    PnlReportResponse,
    UnitEconomicsResponse,
)
from proxy.src.routes.admin_helpers import (
    _date_bounds,
    _get_admin_ozon_creds,
    _parse_date_safe,
    _safe_fetch,
    _safe_fetchone,
    _to_decimal_for_json,
)
from proxy.src.routes.admin_models import ReportPnlOzonRequest
from proxy.src.routes.admin_ozon import ozon_post, resolve_ozon_creds
from proxy.src.services.admin import report_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Reports"])


# ---------------------------------------------------------------------------
# DDS + PnL (delegated to report_service)
# ---------------------------------------------------------------------------


@router.get("/reports/dds", response_model=DdsReportResponse)
async def report_dds(
    request: Request,
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Отчёт о движении денежных средств (ДДС) за период."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await report_service.get_dds_report(
            conn, user_id=str(user["id"]), date_from=date_from, date_to=date_to
        )


@router.get("/reports/pnl", response_model=PnlReportResponse)
async def report_pnl(
    request: Request,
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    group_by: str = Query(default="day", pattern="^(day|month)$"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Отчёт о прибылях и убытках (P&L) с группировкой по дням или месяцам."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await report_service.get_pnl_report(
            conn,
            user_id=str(user["id"]),
            date_from=date_from,
            date_to=date_to,
            group_by=group_by,
        )


# ---------------------------------------------------------------------------
# Unit Economics (per-SKU with stock valuation enrichment)
# ---------------------------------------------------------------------------


@router.get("/reports/unit-economics", response_model=UnitEconomicsResponse)
async def report_unit_economics(
    request: Request,
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Per-SKU unit economics report for a given period."""
    today = datetime.now(tz=timezone.utc).date()
    from_date = _parse_date_safe(date_from, default=today.replace(day=1))
    to_date = _parse_date_safe(date_to, default=today)
    start_dt, end_dt = _date_bounds(from_date, to_date)

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        rows = await _safe_fetch(
            conn,
            """
            SELECT
                sku,
                MAX(product_name) AS product_name,
                COUNT(*) AS operations_count,
                SUM(CASE WHEN finance_type = 'orders' OR (finance_type = '' AND revenue > 0) THEN quantity ELSE 0 END) AS orders_qty,
                SUM(CASE WHEN operation_type = 'ClientReturnAgentOperation' THEN quantity ELSE 0 END) AS returns_qty,
                COUNT(CASE WHEN finance_type = 'services' THEN 1 END) AS services_ops,
                COUNT(CASE WHEN finance_type NOT IN ('orders','services') AND finance_type != '' AND operation_type != 'ClientReturnAgentOperation' THEN 1 END) AS other_ops,
                SUM(revenue) AS total_revenue,
                SUM(sale_commission) AS total_commission,
                SUM(last_mile) AS total_last_mile,
                SUM(pipeline) AS total_pipeline,
                SUM(fulfillment) AS total_fulfillment,
                SUM(dropoff) AS total_dropoff,
                SUM(acquiring) AS total_acquiring,
                SUM(return_logistics) AS total_return_logistics,
                SUM(return_processing) AS total_return_processing,
                SUM(marketing) AS total_marketing,
                SUM(installment) AS total_installment,
                SUM(other_services) AS total_other_services,
                SUM(cogs) AS total_cogs
            FROM ozon_sku_economics
            WHERE user_id = $1
              AND operation_date >= $2
              AND operation_date < $3
              AND sku != 0
            GROUP BY sku
            ORDER BY SUM(revenue) DESC
            """,
            user["id"],
            start_dt,
            end_dt,
        )

        shared_rows = await _safe_fetch(
            conn,
            """
            SELECT
                product_name AS cost_type,
                COUNT(*) AS operations_count,
                SUM(total_amount) AS total_amount,
                SUM(last_mile) AS total_last_mile,
                SUM(pipeline) AS total_pipeline,
                SUM(fulfillment) AS total_fulfillment,
                SUM(dropoff) AS total_dropoff,
                SUM(acquiring) AS total_acquiring,
                SUM(return_logistics) AS total_return_logistics,
                SUM(return_processing) AS total_return_processing,
                SUM(marketing) AS total_marketing,
                SUM(installment) AS total_installment,
                SUM(other_services) AS total_other_services
            FROM ozon_sku_economics
            WHERE user_id = $1
              AND operation_date >= $2
              AND operation_date < $3
              AND sku = 0
            GROUP BY product_name
            ORDER BY SUM(total_amount) ASC
            """,
            user["id"],
            start_dt,
            end_dt,
        )

    # Fetch FIFO lots per SKU for COGS calculation + SKU→card mapping
    fifo_lots_by_sku: dict[int, list[dict]] = {}
    sku_to_card_id: dict[int, str] = {}
    try:
        async with pool.acquire() as conn_lots:
            uid = str(user["id"])
            # Build SKU → master_card_id mapping
            card_sku_rows = await _safe_fetch(
                conn_lots,
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
                uid,
            )
            for csr in card_sku_rows:
                if csr["fbo_sku"] is not None:
                    sku_to_card_id[int(csr["fbo_sku"])] = str(csr["master_card_id"])

            lot_rows_for_cogs = await _safe_fetch(
                conn_lots,
                """
                WITH card_skus AS (
                    SELECT mc.id AS master_card_id,
                           (SELECT v->'data'->>'sku'
                            FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                            WHERE k LIKE 'ozon:%'
                              AND v->'data'->>'sku' IS NOT NULL
                              AND v->'data'->>'sku' ~ '^[0-9]+$'
                            LIMIT 1)::bigint AS fbo_sku
                    FROM master_cards mc
                    WHERE mc.user_id = $1
                )
                SELECT cs.fbo_sku AS sku_id,
                       il.initial_qty, il.unit_cost_rub, il.received_at
                FROM inventory_lots il
                JOIN card_skus cs ON cs.master_card_id = il.master_card_id
                WHERE cs.fbo_sku IS NOT NULL
                ORDER BY cs.fbo_sku, il.received_at ASC
                """,
                uid,
            )
            for lr in lot_rows_for_cogs:
                sid = int(lr["sku_id"])
                fifo_lots_by_sku.setdefault(sid, []).append(
                    {"qty": float(lr["initial_qty"] or 0), "unit_cost": float(lr["unit_cost_rub"])}
                )
    except Exception:
        pass  # If lots unavailable, fall back to DB COGS

    def _fifo_cogs(sku: int, net_sold: int) -> float | None:
        """Calculate FIFO COGS for net_sold units from lots. Returns None if no lots."""
        lots = fifo_lots_by_sku.get(sku)
        if not lots or net_sold <= 0:
            return None
        total = 0.0
        remaining = float(net_sold)
        for lot in lots:
            take = min(remaining, lot["qty"])
            total += take * lot["unit_cost"]
            remaining -= take
            if remaining <= 0:
                break
        return round(total, 2)

    # Build per-SKU items
    cost_columns = [
        "commission",
        "last_mile",
        "pipeline",
        "fulfillment",
        "dropoff",
        "acquiring",
        "return_logistics",
        "return_processing",
        "marketing",
        "installment",
        "other_services",
    ]
    items = []
    totals = {
        "revenue": 0,
        "commission": 0,
        "last_mile": 0,
        "pipeline": 0,
        "fulfillment": 0,
        "dropoff": 0,
        "acquiring": 0,
        "return_logistics": 0,
        "return_processing": 0,
        "marketing": 0,
        "installment": 0,
        "other_services": 0,
        "cogs": 0,
    }
    for row in rows:
        r = dict(row)
        cost_sum = sum(float(r.get(f"total_{col}") or 0) for col in cost_columns)
        orders_qty = int(r.get("orders_qty") or 0)
        returns_qty = int(r.get("returns_qty") or 0)
        net_sold = max(0, orders_qty - returns_qty)
        # FIFO COGS: consume net_sold units from lots (returns go back to stock)
        fifo_val = _fifo_cogs(r["sku"], net_sold)
        cogs_val = fifo_val if fifo_val is not None else float(r.get("total_cogs") or 0)
        revenue_val = float(r.get("total_revenue") or 0)
        profit = revenue_val + cost_sum - cogs_val
        margin_pct = round(profit / revenue_val * 100, 1) if revenue_val else 0

        item = {
            "sku": r["sku"],
            "master_card_id": sku_to_card_id.get(r["sku"]),
            "product_name": r["product_name"] or "",
            "operations_count": r["operations_count"],
            "orders_qty": int(r.get("orders_qty") or 0),
            "returns_qty": int(r.get("returns_qty") or 0),
            "services_ops": int(r.get("services_ops") or 0),
            "other_ops": int(r.get("other_ops") or 0),
            "revenue": float(r.get("total_revenue") or 0),
            "commission": float(r.get("total_commission") or 0),
            "last_mile": float(r.get("total_last_mile") or 0),
            "pipeline": float(r.get("total_pipeline") or 0),
            "fulfillment": float(r.get("total_fulfillment") or 0),
            "dropoff": float(r.get("total_dropoff") or 0),
            "acquiring": float(r.get("total_acquiring") or 0),
            "return_logistics": float(r.get("total_return_logistics") or 0),
            "return_processing": float(r.get("total_return_processing") or 0),
            "marketing": float(r.get("total_marketing") or 0),
            "installment": float(r.get("total_installment") or 0),
            "other_services": float(r.get("total_other_services") or 0),
            "cogs": cogs_val,
            "profit": round(profit, 2),
            "margin_pct": margin_pct,
        }
        items.append(item)

        for key in totals:
            totals[key] += item.get(key, 0)

    total_profit = totals["revenue"] + sum(totals[col] for col in cost_columns) - totals["cogs"]
    total_margin = round(total_profit / totals["revenue"] * 100, 1) if totals["revenue"] else 0

    shared_costs = []
    shared_total = 0.0
    for sr in shared_rows:
        r = dict(sr)
        amount = float(r.get("total_amount") or 0)
        shared_total += amount
        shared_costs.append(
            {
                "cost_type": r.get("cost_type") or "Прочее",
                "operations_count": r.get("operations_count") or 0,
                "amount": round(amount, 2),
            }
        )

    # ---- Stock Valuation Enrichment ----
    stock_valuation_items: list[dict[str, Any]] = []
    sv_totals = {"stock_value_cost": 0.0, "stock_value_ozon": 0.0, "potential_profit": 0.0}
    try:
        async with pool.acquire() as conn2:
            client_id, api_key = await resolve_ozon_creds(
                conn2, admin_user_id=str(user["id"]), client_id=None, api_key=None
            )
            uid = str(user["id"])
            mapping_rows = await _safe_fetch(
                conn2,
                """
                SELECT
                    mc.ozon_offer_id,
                    mc.ozon_product_id,
                    (SELECT v->'data'->>'sku'
                     FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                     WHERE k LIKE 'ozon:%'
                       AND v->'data'->>'sku' IS NOT NULL
                       AND v->'data'->>'sku' ~ '^[0-9]+$'
                     LIMIT 1)::bigint AS fbo_sku
                FROM master_cards mc
                WHERE mc.user_id = $1
                  AND mc.ozon_offer_id IS NOT NULL AND mc.status != 'archived'
                """,
                uid,
            )
            sku_to_offer: dict[int, str] = {}
            sku_to_product: dict[int, str] = {}
            for mr in mapping_rows:
                fbo = mr["fbo_sku"]
                if fbo is None:
                    continue
                fbo = int(fbo)
                sku_to_offer[fbo] = str(mr["ozon_offer_id"] or "")
                sku_to_product[fbo] = str(mr["ozon_product_id"] or "")

            lot_rows = await _safe_fetch(
                conn2,
                """
                WITH card_skus AS (
                    SELECT mc.id AS master_card_id,
                           (SELECT v->'data'->>'sku'
                            FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                            WHERE k LIKE 'ozon:%'
                              AND v->'data'->>'sku' IS NOT NULL
                              AND v->'data'->>'sku' ~ '^[0-9]+$'
                            LIMIT 1)::bigint AS fbo_sku
                    FROM master_cards mc
                    WHERE mc.user_id = $1
                )
                SELECT cs.fbo_sku AS sku_id,
                       il.initial_qty, il.unit_cost_rub,
                       il.received_at,
                       so.id AS order_id,
                       so.order_number
                FROM inventory_lots il
                JOIN card_skus cs ON cs.master_card_id = il.master_card_id
                LEFT JOIN supplier_order_items soi
                    ON soi.id = il.supplier_order_item_id
                LEFT JOIN supplier_orders so
                    ON so.id = soi.supplier_order_id
                WHERE cs.fbo_sku IS NOT NULL
                ORDER BY cs.fbo_sku, il.received_at ASC
                """,
                uid,
            )
            lots_by_sku: dict[int, list[dict]] = {}
            for lr in lot_rows:
                sid = int(lr["sku_id"])
                lots_by_sku.setdefault(sid, []).append(
                    {
                        "initial_qty": float(lr["initial_qty"] or 0),
                        "unit_cost": float(lr["unit_cost_rub"]),
                        "received_at": (
                            lr["received_at"].isoformat() if lr["received_at"] else None
                        ),
                        "order_id": (str(lr["order_id"]) if lr["order_id"] else None),
                        "order_number": lr["order_number"],
                    }
                )

        # Fetch Ozon stock levels (FBS + FBO)
        stock_by_offer: dict[str, int] = {}
        stock_by_product: dict[str, int] = {}
        async with httpx.AsyncClient(timeout=90.0) as ozon_client:
            cursor = ""
            for _ in range(20):
                body: dict[str, Any] = {
                    "filter": {"visibility": "ALL"},
                    "cursor": cursor,
                    "limit": 1000,
                }
                try:
                    sdata = await ozon_post(
                        "/v4/product/info/stocks",
                        body,
                        client_id=client_id,
                        api_key=api_key,
                        http_client=ozon_client,
                    )
                except HTTPException:
                    break
                sitems = sdata.get("items", [])
                if not sitems:
                    break
                for si in sitems:
                    total_present = sum(s.get("present", 0) for s in (si.get("stocks") or []))
                    oid = str(si.get("offer_id", ""))
                    pid = str(si.get("product_id", ""))
                    if oid:
                        stock_by_offer[oid] = stock_by_offer.get(oid, 0) + total_present
                    if pid:
                        stock_by_product[pid] = stock_by_product.get(pid, 0) + total_present
                cursor = sdata.get("cursor", "")
                if not cursor or len(sitems) < 1000:
                    break
            try:
                fbo_data = await ozon_post(
                    "/v1/analytics/stocks",
                    {"limit": 1000, "offset": 0, "warehouse_type": "ALL"},
                    client_id=client_id,
                    api_key=api_key,
                    http_client=ozon_client,
                )
                for frow in fbo_data.get("result", {}).get("rows", []):
                    oid = str(frow.get("offer_id", ""))
                    pid = str(frow.get("product_id", ""))
                    fbo_present = frow.get("free_to_sell_amount", 0) or 0
                    if oid:
                        stock_by_offer[oid] = stock_by_offer.get(oid, 0) + fbo_present
                    if pid:
                        stock_by_product[pid] = stock_by_product.get(pid, 0) + fbo_present
            except HTTPException:
                pass

        # Map stock to fbo_sku
        stock_by_sku: dict[int, int] = {}
        for fbo_sku in set(list(sku_to_offer.keys()) + list(sku_to_product.keys())):
            oid = sku_to_offer.get(fbo_sku, "")
            pid = sku_to_product.get(fbo_sku, "")
            stock = stock_by_offer.get(oid) or stock_by_product.get(pid) or 0
            if stock > 0:
                stock_by_sku[fbo_sku] = stock

        # FIFO: consume lots based on actual Ozon stock
        cost_by_sku: dict[int, float] = {}
        remaining_lots_by_sku: dict[int, list[dict]] = {}
        purchased_by_sku: dict[int, int] = {}
        for sku_id, lots in lots_by_sku.items():
            total_purchased = sum(lot["initial_qty"] for lot in lots)
            purchased_by_sku[sku_id] = int(total_purchased)
            actual_stock = stock_by_sku.get(sku_id, 0)
            consumed = max(0, total_purchased - actual_stock)

            remaining_qty = 0
            remaining_cost = 0.0
            remaining_lots: list[dict] = []
            for lot in lots:
                qty = lot["initial_qty"]
                unit_cost = lot["unit_cost"]
                if consumed >= qty:
                    consumed -= qty
                    continue
                elif consumed > 0:
                    left = qty - consumed
                    consumed = 0
                else:
                    left = qty
                remaining_qty += left
                remaining_cost += left * unit_cost
                remaining_lots.append(
                    {
                        "qty": left,
                        "unit_cost": round(unit_cost, 2),
                        "received_at": lot["received_at"],
                        "order_id": lot["order_id"],
                        "order_number": lot["order_number"],
                    }
                )
            if remaining_qty > 0:
                cost_by_sku[sku_id] = remaining_cost / remaining_qty
                remaining_lots_by_sku[sku_id] = remaining_lots

        # Fetch Ozon current prices (v5)
        price_by_offer: dict[str, float] = {}
        price_by_product: dict[str, float] = {}
        async with httpx.AsyncClient(timeout=90.0) as ozon_client:
            price_cursor = ""
            for _ in range(20):
                pbody: dict[str, Any] = {
                    "filter": {"visibility": "ALL"},
                    "limit": 1000,
                    "cursor": price_cursor,
                }
                try:
                    pdata = await ozon_post(
                        "/v5/product/info/prices",
                        pbody,
                        client_id=client_id,
                        api_key=api_key,
                        http_client=ozon_client,
                    )
                except HTTPException:
                    break
                pitems = pdata.get("items", [])
                if not pitems:
                    break
                for pi in pitems:
                    oid = str(pi.get("offer_id", ""))
                    pid = str(pi.get("product_id", ""))
                    price_val = float(pi.get("price", {}).get("price", 0) or 0)
                    if oid and price_val > 0:
                        price_by_offer[oid] = price_val
                    if pid and price_val > 0:
                        price_by_product[pid] = price_val
                price_cursor = pdata.get("cursor", "")
                if not price_cursor or len(pitems) < 1000:
                    break

        # Map price to fbo_sku
        price_by_sku: dict[int, float] = {}
        for fbo_sku in set(list(sku_to_offer.keys()) + list(sku_to_product.keys())):
            oid = sku_to_offer.get(fbo_sku, "")
            pid = sku_to_product.get(fbo_sku, "")
            price = price_by_offer.get(oid) or price_by_product.get(pid) or 0
            if price > 0:
                price_by_sku[fbo_sku] = price

        # Build stock valuation per UE SKU
        margin_by_sku = {item["sku"]: item["margin_pct"] for item in items}
        for item in items:
            sku = item["sku"]
            stock = stock_by_sku.get(sku, 0)
            if stock <= 0:
                continue
            price_ozon = price_by_sku.get(sku, 0)
            cost_unit = cost_by_sku.get(sku, 0)
            margin = margin_by_sku.get(sku, 0)
            stock_val_cost = round(stock * cost_unit, 2)
            stock_val_ozon = round(stock * price_ozon, 2)
            potential = (
                round(stock * price_ozon * margin / 100, 2) if price_ozon > 0 and margin else 0
            )
            stock_valuation_items.append(
                {
                    "sku": sku,
                    "product_name": item["product_name"],
                    "stock": stock,
                    "total_purchased": purchased_by_sku.get(sku, 0),
                    "price_ozon": price_ozon,
                    "cost_per_unit": round(cost_unit, 2),
                    "margin_pct": margin,
                    "stock_value_cost": stock_val_cost,
                    "stock_value_ozon": stock_val_ozon,
                    "potential_profit": potential,
                    "lots": lots_by_sku.get(sku, []),
                }
            )
            sv_totals["stock_value_cost"] += stock_val_cost
            sv_totals["stock_value_ozon"] += stock_val_ozon
            sv_totals["potential_profit"] += potential
    except Exception as sv_exc:
        logger.warning("Stock valuation enrichment failed: %s", sv_exc)

    return _to_decimal_for_json(
        {
            "date_from": from_date.isoformat(),
            "date_to": to_date.isoformat(),
            "items": items,
            "totals": {
                **{k: round(v, 2) for k, v in totals.items()},
                "profit": round(total_profit, 2),
                "margin_pct": total_margin,
            },
            "shared_costs": shared_costs,
            "shared_total": round(shared_total, 2),
            "stock_valuation": {
                "items": stock_valuation_items,
                "totals": {k: round(v, 2) for k, v in sv_totals.items()},
            },
        }
    )


# ---------------------------------------------------------------------------
# P&L Ozon (uses /v1/finance/balance API + our COGS from DB)
# ---------------------------------------------------------------------------

_PNL_SERVICE_GROUPS: dict[str, list[str]] = {
    "logistics": [
        "DirectFlowTrans",
        "DirectFlowLogistic",
        "DelivToCustomer",
        "DeliveryKGT",
        "Dropoff",
        "Pickup",
    ],
    "fbo": ["Fulfillment", "FreightReturn"],
    "acquiring": ["Acquiring"],
    "marketing": ["Marketing", "Premium", "Reviews", "Cashback"],
    "returns": ["Return", "NotDeliv", "NotDelivered"],
    "other": [],
}


def _classify_service(name: str) -> str:
    """Classify an Ozon service name into a P&L group."""
    for group, keywords in _PNL_SERVICE_GROUPS.items():
        if group == "other":
            continue
        for kw in keywords:
            if kw.lower() in name.lower():
                return group
    return "other"


@router.post("/reports/pnl-ozon", response_model=PnlOzonResponse)
async def report_pnl_ozon(
    request: Request,
    body: ReportPnlOzonRequest | None = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """P&L report using Ozon /v1/finance/balance API + our COGS from DB."""
    payload = body or ReportPnlOzonRequest()
    today = datetime.now(tz=timezone.utc).date()
    from_date = _parse_date_safe(payload.date_from, default=today.replace(day=1))
    to_date = _parse_date_safe(payload.date_to, default=today)

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await _get_admin_ozon_creds(conn, user["id"])
        if not client_id or not api_key:
            raise HTTPException(status_code=400, detail="Ozon credentials not configured")

        rate_row = await _safe_fetchone(
            conn,
            "SELECT usn_rate FROM admin_users WHERE id = $1",
            user["id"],
        )
        usn_rate = float(rate_row["usn_rate"]) if rate_row and rate_row["usn_rate"] else 7.0

        ozon_data = await ozon_post(
            "/v1/finance/balance",
            {
                "date_from": from_date.isoformat(),
                "date_to": to_date.isoformat(),
            },
            client_id=client_id,
            api_key=api_key,
        )

        start_dt, end_dt = _date_bounds(from_date, to_date)
        cogs_row = await _safe_fetchone(
            conn,
            """
            SELECT COALESCE(SUM(cogs), 0) AS total_cogs
            FROM ozon_sku_economics
            WHERE user_id = $1
              AND operation_date >= $2
              AND operation_date < $3
              AND sku != 0
            """,
            user["id"],
            start_dt,
            end_dt,
        )

        manual_rows = await _safe_fetch(
            conn,
            """
            SELECT kind, category, COALESCE(SUM(amount_rub), 0) AS total
            FROM finance_transactions
            WHERE user_id = $1 AND happened_at >= $2 AND happened_at < $3
              AND source = 'manual'
            GROUP BY kind, category
            """,
            user["id"],
            start_dt,
            end_dt,
        )

    cogs_total = float(cogs_row["total_cogs"]) if cogs_row else 0.0
    manual_income = 0.0
    manual_expense = 0.0
    manual_income_detail: list[dict[str, Any]] = []
    manual_expense_detail: list[dict[str, Any]] = []
    for mr in manual_rows:
        cat = mr["category"] or "без категории"
        amt = float(mr["total"])
        if mr["kind"] == "income":
            manual_income += amt
            manual_income_detail.append({"category": cat, "amount": round(amt, 2)})
        elif mr["kind"] == "expense":
            manual_expense += amt
            manual_expense_detail.append({"category": cat, "amount": round(amt, 2)})

    # Parse Ozon response
    cashflows = ozon_data.get("cashflows") or {}
    sales = cashflows.get("sales") or {}
    returns = cashflows.get("returns") or {}
    services = cashflows.get("services") or []

    def _amount_val(obj: Any) -> float:
        if isinstance(obj, dict):
            return float(obj.get("value") or 0)
        return float(obj or 0)

    # Income
    sales_total = _amount_val(sales.get("amount"))
    sales_details = sales.get("amount_details") or {}
    sales_revenue = _amount_val(sales_details.get("revenue"))
    sales_points = float(sales_details.get("points_for_discounts") or 0)
    sales_partner = _amount_val(sales_details.get("partner_programs"))
    sales_fee = _amount_val(sales.get("fee"))

    returns_total = _amount_val(returns.get("amount"))
    returns_details = returns.get("amount_details") or {}
    returns_revenue = _amount_val(returns_details.get("revenue"))
    returns_points = float(returns_details.get("points_for_discounts") or 0)
    returns_partner = _amount_val(returns_details.get("partner_programs"))
    returns_fee = _amount_val(returns.get("fee"))

    commission = sales_fee + returns_fee

    expense_groups: dict[str, float] = {
        "logistics": 0,
        "fbo": 0,
        "acquiring": 0,
        "marketing": 0,
        "returns": 0,
        "other": 0,
    }
    services_detail: list[dict[str, Any]] = []
    for svc in services:
        svc_name = svc.get("name") or ""
        svc_amount = _amount_val(svc.get("amount"))
        group = _classify_service(svc_name)
        expense_groups[group] += svc_amount
        if svc_amount:
            services_detail.append(
                {"name": svc_name, "amount": round(svc_amount, 2), "group": group}
            )

    ozon_expenses_total = commission + sum(expense_groups.values())

    taxable_revenue = sales_revenue + returns_revenue
    tax_usn = round(taxable_revenue * usn_rate / 100, 2) if taxable_revenue > 0 else 0

    net_income = sales_total + returns_total
    net_profit = (
        net_income + ozon_expenses_total - cogs_total - tax_usn + manual_income - manual_expense
    )
    margin_pct = round(net_profit / net_income * 100, 1) if net_income else 0

    return _to_decimal_for_json(
        {
            "date_from": from_date.isoformat(),
            "date_to": to_date.isoformat(),
            "income": {
                "net_income": round(net_income, 2),
                "total_sales": round(sales_total, 2),
                "revenue": round(sales_revenue, 2),
                "points_for_discounts": round(sales_points, 2),
                "partner_programs": round(sales_partner, 2),
                "returns_total": round(returns_total, 2),
                "returns_revenue": round(returns_revenue, 2),
                "returns_points": round(returns_points, 2),
                "returns_partner": round(returns_partner, 2),
            },
            "ozon_expenses": {
                "commission": round(commission, 2),
                "logistics": round(expense_groups["logistics"], 2),
                "fbo": round(expense_groups["fbo"], 2),
                "acquiring": round(expense_groups["acquiring"], 2),
                "marketing": round(expense_groups["marketing"], 2),
                "returns": round(expense_groups["returns"], 2),
                "other": round(expense_groups["other"], 2),
                "total": round(ozon_expenses_total, 2),
            },
            "services_detail": services_detail,
            "cogs": round(cogs_total, 2),
            "manual_income": round(manual_income, 2),
            "manual_income_detail": manual_income_detail,
            "manual_expense": round(manual_expense, 2),
            "manual_expense_detail": manual_expense_detail,
            "tax_usn": round(tax_usn, 2),
            "usn_rate": usn_rate,
            "taxable_revenue": round(taxable_revenue, 2),
            "net_profit": round(net_profit, 2),
            "margin_pct": margin_pct,
        }
    )
