from __future__ import annotations

import json
from typing import Any

import asyncpg
from proxy.src.repositories.admin.base import safe_fetch, safe_fetchone
from proxy.src.routes.admin.list_query import ListQuery, WhereBuilder

CARDS_SORT_MAP = {
    "created_at": "mc.created_at",
    "updated_at": "mc.updated_at",
    "title": "mc.title",
    "sku": "mc.sku",
}


async def list_cards(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    lq: ListQuery,
    include_archived: bool,
) -> tuple[list[asyncpg.Record], int]:
    wb = WhereBuilder()
    wb.exact("mc.user_id", user_id)
    wb.ilike_multi(["mc.title", "mc.sku", "mc.brand"], lq.q)
    if not include_archived:
        wb.not_equal("mc.status", "archived")

    where_sql, params = wb.build()

    total_row = await safe_fetchone(
        conn,
        f"SELECT COUNT(*) AS total FROM master_cards mc {where_sql}",
        *params,
    )
    total = int(total_row["total"]) if total_row else 0

    sort_col = CARDS_SORT_MAP[lq.sort_field]
    limit_idx = len(params) + 1
    offset_idx = len(params) + 2

    rows = await safe_fetch(
        conn,
        f"""
        SELECT
            mc.*,
            COALESCE(SUM(il.remaining_qty), 0) AS stock_qty,
            COALESCE(SUM(il.remaining_qty * il.unit_cost_rub), 0) AS stock_value_rub
        FROM master_cards mc
        LEFT JOIN inventory_lots il ON il.master_card_id = mc.id
        {where_sql}
        GROUP BY mc.id
        ORDER BY {sort_col} {lq.sort_dir}
        LIMIT ${limit_idx} OFFSET ${offset_idx}
        """,
        *params,
        lq.limit,
        lq.offset,
    )
    return rows, total


async def get_card(
    conn: asyncpg.Connection, *, card_id: str, user_id: str
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        SELECT
            mc.*,
            COALESCE(SUM(il.remaining_qty), 0) AS stock_qty,
            COALESCE(SUM(il.remaining_qty * il.unit_cost_rub), 0) AS stock_value_rub
        FROM master_cards mc
        LEFT JOIN inventory_lots il ON il.master_card_id = mc.id
        WHERE mc.id = $1 AND mc.user_id = $2
        GROUP BY mc.id
        """,
        card_id,
        user_id,
    )


async def get_card_lots(conn: asyncpg.Connection, *, card_id: str) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        """
        SELECT l.id, l.master_card_id, l.supplier_order_item_id,
               l.received_at, l.initial_qty, l.remaining_qty, l.unit_cost_rub,
               i.purchase_price_rub, i.packaging_cost_rub, i.logistics_cost_rub,
               i.customs_cost_rub, i.extra_cost_rub, i.allocations
        FROM inventory_lots l
        LEFT JOIN supplier_order_items i ON i.id = l.supplier_order_item_id
        WHERE l.master_card_id = $1
        ORDER BY l.received_at ASC
        """,
        card_id,
    )


async def get_card_sales(conn: asyncpg.Connection, *, card_id: str) -> list[asyncpg.Record]:
    return await safe_fetch(
        conn,
        """
        SELECT
            soi.id, soi.quantity, soi.unit_sale_price_rub, soi.revenue_rub,
            soi.fee_rub, soi.cogs_rub, soi.gross_profit_rub, soi.source_offer_id,
            so.sold_at, so.external_order_id, so.marketplace, so.status,
            ue.ue_revenue, ue.ue_commission, ue.ue_last_mile, ue.ue_pipeline,
            ue.ue_fulfillment, ue.ue_dropoff, ue.ue_acquiring,
            ue.ue_return_logistics, ue.ue_return_processing,
            ue.ue_marketing, ue.ue_other_services, ue.ue_total
        FROM sales_order_items soi
        JOIN sales_orders so ON so.id = soi.sales_order_id
        LEFT JOIN LATERAL (
            SELECT
                SUM(ose.revenue) AS ue_revenue,
                SUM(ose.sale_commission) AS ue_commission,
                SUM(ose.last_mile) AS ue_last_mile,
                SUM(ose.pipeline) AS ue_pipeline,
                SUM(ose.fulfillment) AS ue_fulfillment,
                SUM(ose.dropoff) AS ue_dropoff,
                SUM(ose.acquiring) AS ue_acquiring,
                SUM(ose.return_logistics) AS ue_return_logistics,
                SUM(ose.return_processing) AS ue_return_processing,
                SUM(ose.marketing) AS ue_marketing,
                SUM(ose.other_services) AS ue_other_services,
                SUM(ose.total_amount) AS ue_total
            FROM ozon_sku_economics ose
            WHERE ose.user_id = so.user_id
              AND (ose.posting_number = so.external_order_id
                   OR so.external_order_id LIKE ose.posting_number || '-%')
        ) ue ON true
        WHERE soi.master_card_id = $1
        ORDER BY so.sold_at DESC, soi.created_at DESC
        LIMIT 100
        """,
        card_id,
    )


async def create_card(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    sku: str | None,
    title: str,
    description: str | None,
    brand: str | None,
    ozon_product_id: str | None,
    ozon_offer_id: str | None,
    status: str,
    attributes: dict[str, Any],
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO master_cards (
            sku, title, description, brand,
            ozon_product_id, ozon_offer_id, status, attributes, user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        """,
        sku,
        title,
        description,
        brand,
        ozon_product_id,
        ozon_offer_id,
        status,
        json.dumps(attributes),
        user_id,
    )


async def update_card(
    conn: asyncpg.Connection,
    *,
    card_id: str,
    user_id: str,
    fields: dict[str, Any],
) -> asyncpg.Record | None:
    if not fields:
        return None

    values: list[Any] = []
    parts: list[str] = []
    for key, value in fields.items():
        if key == "attributes" and isinstance(value, dict):
            values.append(json.dumps(value))
        else:
            values.append(value)
        parts.append(f"{key} = ${len(values)}")

    parts.append("updated_at = NOW()")
    values.append(card_id)
    values.append(user_id)

    query = f"""
        UPDATE master_cards
        SET {", ".join(parts)}
        WHERE id = ${len(values) - 1} AND user_id = ${len(values)}
        RETURNING *
    """
    return await safe_fetchone(conn, query, *values)


async def get_card_raw(
    conn: asyncpg.Connection, *, card_id: str, user_id: str
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn, "SELECT * FROM master_cards WHERE id = $1 AND user_id = $2", card_id, user_id
    )
