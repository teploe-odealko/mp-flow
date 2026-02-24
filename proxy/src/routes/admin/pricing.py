"""Pricing endpoints: commission lookup, breakeven calculator, product pricing analysis."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from proxy.src.repositories.admin.base import safe_fetch, safe_fetchone
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.list_query import ListQuery, WhereBuilder, list_query_dep, list_response
from proxy.src.routes.admin_ozon import (
    create_sync_run,
    finish_sync_run,
    load_ozon_products,
    ozon_post,
    resolve_ozon_creds,
)
from proxy.src.services.admin.pricing_service import calculate_breakeven
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Pricing"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class CommissionLookupRequest(BaseModel):
    category: str
    product_type: str
    price: float | None = None
    scheme: str = "FBO"


class BreakevenRequest(BaseModel):
    cogs_rub: float
    commission_pct: float | None = None
    # If commission_pct is None, use category/type to look up tiers
    category: str | None = None
    product_type: str | None = None
    scheme: str = "FBO"
    acquiring_pct: float = 1.5
    last_mile_rub: float = 63.0
    storage_per_day_rub: float = 0
    storage_days: int = 30
    return_rate_pct: float = 5.0
    return_logistics_rub: float = 50.0
    usn_rate_pct: float = 7.0
    sale_price_rub: float | None = None
    target_margin_pct: float | None = None
    margin_targets: list[float] | None = None


class PriceUpdateItem(BaseModel):
    offer_id: str
    price: float | None = None
    min_price: float | None = None
    old_price: float | None = None


class SetPricesRequest(BaseModel):
    updates: list[PriceUpdateItem]


# ---------------------------------------------------------------------------
# 1. GET /pricing/categories — 629 unique category names
# ---------------------------------------------------------------------------


@router.get("/pricing/categories")
async def list_categories(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        rows = await safe_fetch(
            conn,
            "SELECT DISTINCT category FROM ozon_commission_rates ORDER BY category",
        )
    return {"categories": [r["category"] for r in rows]}


# ---------------------------------------------------------------------------
# 2. GET /pricing/categories/{category}/types — types for a category
# ---------------------------------------------------------------------------


@router.get("/pricing/categories/{category}/types")
async def list_category_types(
    category: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        rows = await safe_fetch(
            conn,
            "SELECT DISTINCT product_type FROM ozon_commission_rates WHERE category = $1 ORDER BY product_type",
            category,
        )
    return {"types": [r["product_type"] for r in rows]}


# ---------------------------------------------------------------------------
# 3. POST /pricing/commission-lookup — commission rate for category/type/price
# ---------------------------------------------------------------------------


@router.post("/pricing/commission-lookup")
async def commission_lookup(
    payload: CommissionLookupRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        if payload.price is not None:
            row = await safe_fetchone(
                conn,
                """
                SELECT rate FROM ozon_commission_rates
                WHERE category = $1 AND product_type = $2 AND scheme = $3
                  AND price_min <= $4
                  AND (price_max IS NULL OR price_max > $4)
                ORDER BY valid_from DESC LIMIT 1
                """,
                payload.category,
                payload.product_type,
                payload.scheme,
                payload.price,
            )
            if row:
                rate = float(row["rate"])
                return {"rate": rate, "rate_pct": round(rate * 100, 2)}
            return {"rate": None, "rate_pct": None}
        else:
            rows = await safe_fetch(
                conn,
                """
                SELECT price_min, price_max, rate FROM ozon_commission_rates
                WHERE category = $1 AND product_type = $2 AND scheme = $3
                ORDER BY price_min
                """,
                payload.category,
                payload.product_type,
                payload.scheme,
            )
            tiers = [
                {
                    "price_min": float(r["price_min"]),
                    "price_max": float(r["price_max"]) if r["price_max"] is not None else None,
                    "rate": float(r["rate"]),
                    "rate_pct": round(float(r["rate"]) * 100, 2),
                }
                for r in rows
            ]
            return {"tiers": tiers}


# ---------------------------------------------------------------------------
# 4. POST /pricing/breakeven — full breakeven calculation
# ---------------------------------------------------------------------------


async def _load_commission_tiers(
    conn: Any, category: str, product_type: str, scheme: str
) -> list[dict]:
    rows = await safe_fetch(
        conn,
        """
        SELECT price_min, price_max, rate FROM ozon_commission_rates
        WHERE category = $1 AND product_type = $2 AND scheme = $3
        ORDER BY price_min
        """,
        category,
        product_type,
        scheme,
    )
    return [
        {
            "price_min": float(r["price_min"]),
            "price_max": float(r["price_max"]) if r["price_max"] is not None else None,
            "rate": float(r["rate"]),
        }
        for r in rows
    ]


@router.post("/pricing/breakeven")
async def breakeven(
    payload: BreakevenRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    commission_tiers = None
    if payload.commission_pct is None and payload.category and payload.product_type:
        pool = get_db_pool(request)
        async with pool.acquire() as conn:
            commission_tiers = await _load_commission_tiers(
                conn, payload.category, payload.product_type, payload.scheme
            )
        if not commission_tiers:
            return {"error": f"No commission data for {payload.category} / {payload.product_type}"}

    return calculate_breakeven(
        cogs_rub=payload.cogs_rub,
        commission_pct=payload.commission_pct,
        commission_tiers=commission_tiers,
        acquiring_pct=payload.acquiring_pct,
        last_mile_rub=payload.last_mile_rub,
        storage_per_day_rub=payload.storage_per_day_rub,
        storage_days=payload.storage_days,
        return_rate_pct=payload.return_rate_pct,
        return_logistics_rub=payload.return_logistics_rub,
        usn_rate_pct=payload.usn_rate_pct,
        sale_price_rub=payload.sale_price_rub,
        target_margin_pct=payload.target_margin_pct,
        margin_targets=payload.margin_targets,
    )


# ---------------------------------------------------------------------------
# 5. POST /pricing/sync — sync categories + prices from Ozon
# ---------------------------------------------------------------------------


def _build_category_map(tree_data: dict) -> dict[int, dict]:
    """Recursively flatten Ozon category tree into {description_category_id: {name, types: {type_id: type_name}}}.

    The tree has 3 levels:
      L1: top categories (e.g. "Фермерское хозяйство")
      L2: subcategories with description_category_id (e.g. "Вывод пчелиных маток")
      L3: types with type_id + type_name (leaf nodes)

    We use L2 category_name as the name (matches ozon_commission_rates table).
    """
    result: dict[int, dict] = {}

    def _walk(nodes: list[dict]):
        for node in nodes:
            cat_id = node.get("description_category_id") or node.get("category_id")
            cat_name = node.get("category_name") or node.get("title") or ""
            children = node.get("children", [])

            if cat_id:
                # Check if children are types (have type_id) or subcategories
                types = {}
                sub_categories = []
                for child in children:
                    if child.get("type_id") is not None:
                        types[int(child["type_id"])] = child.get("type_name") or ""
                    elif child.get("children"):
                        sub_categories.append(child)

                if types:
                    # This is a leaf category with types — use its own name
                    result[int(cat_id)] = {"name": cat_name, "types": types}

                # Recurse into subcategories
                if sub_categories:
                    _walk(sub_categories)
            else:
                # No cat_id, just recurse
                _walk(children)

    root = tree_data.get("result", tree_data.get("children", tree_data))
    if isinstance(root, list):
        _walk(root)
    elif isinstance(root, dict) and root.get("children"):
        _walk(root["children"])
    return result


@router.post("/pricing/sync")
async def sync_pricing(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Sync Ozon categories and prices into master_cards."""
    pool = get_db_pool(request)
    user_id = str(user["id"])

    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn, admin_user_id=user_id, client_id=None, api_key=None
        )
        run_id = await create_sync_run(conn, sync_type="pricing_sync", user_id=user["id"])

    async with httpx.AsyncClient(timeout=90.0) as ozon_client:
        # 1. Load products from Ozon (reuse existing helper)
        products, _ = await load_ozon_products(
            client_id=client_id,
            api_key=api_key,
            page_size=1000,
            max_pages=10,
            visibility="ALL",
            http_client=ozon_client,
        )

        # 2. Fetch Ozon category tree
        try:
            tree_data = await ozon_post(
                "/v1/description-category/tree",
                {"language": "DEFAULT"},
                client_id=client_id,
                api_key=api_key,
                http_client=ozon_client,
            )
        except HTTPException:
            tree_data = {}

        cat_map = _build_category_map(tree_data)

        # 3. Fetch prices via /v5/product/info/prices (cursor pagination)
        price_map: dict[str, dict] = {}  # offer_id -> {price, min_price, old_price}
        price_cursor = ""
        for _ in range(20):
            try:
                pdata = await ozon_post(
                    "/v5/product/info/prices",
                    {"filter": {"visibility": "ALL"}, "limit": 1000, "cursor": price_cursor},
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
                if not oid:
                    continue
                pp = pi.get("price", {})
                cc = pi.get("commissions", {})
                price_map[oid] = {
                    "price": float(pp.get("price", 0) or 0),
                    "min_price": float(pp.get("min_price", 0) or 0),
                    "old_price": float(pp.get("old_price", 0) or 0),
                    "marketing_seller_price": float(pp.get("marketing_seller_price", 0) or 0),
                    # FBO tariffs (per-product, from Ozon)
                    "acquiring_rub": float(pi.get("acquiring", 0) or 0),
                    "fbo_last_mile_rub": float(cc.get("fbo_deliv_to_customer_amount", 0) or 0),
                    "fbo_pipeline_min_rub": float(
                        cc.get("fbo_direct_flow_trans_min_amount", 0) or 0
                    ),
                    "fbo_pipeline_max_rub": float(
                        cc.get("fbo_direct_flow_trans_max_amount", 0) or 0
                    ),
                    "fbo_return_flow_rub": float(cc.get("fbo_return_flow_amount", 0) or 0),
                    "fbo_commission_pct": float(cc.get("sales_percent_fbo", 0) or 0),
                }
            price_cursor = pdata.get("cursor", "")
            if not price_cursor or len(pitems) < 1000:
                break

    # 4. Map products to categories and update master_cards
    synced = 0
    categories_mapped = 0
    unmapped: list[str] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            for product in products:
                offer_id = str(product.get("offer_id") or "")
                if not offer_id:
                    continue

                raw = product.get("raw") or {}
                # raw may be {"list": {...}, "info": {...}} or flat dict
                info = raw.get("info") or raw.get("list") or raw
                desc_cat_id = info.get("description_category_id")
                type_id = info.get("type_id")

                cat_name = None
                type_name = None
                if desc_cat_id and int(desc_cat_id) in cat_map:
                    cat_info = cat_map[int(desc_cat_id)]
                    cat_name = cat_info["name"]
                    if type_id is not None:
                        type_name = cat_info["types"].get(int(type_id))
                    if cat_name:
                        categories_mapped += 1
                    else:
                        unmapped.append(offer_id)
                elif desc_cat_id:
                    unmapped.append(offer_id)

                # Get prices for this offer
                prices = price_map.get(offer_id, {})

                # Update master_cards
                result = await conn.execute(
                    """
                    UPDATE master_cards
                    SET ozon_category_name = COALESCE($2, ozon_category_name),
                        ozon_product_type_name = COALESCE($3, ozon_product_type_name),
                        attributes = attributes || $4::jsonb,
                        updated_at = NOW()
                    WHERE user_id = $5 AND ozon_offer_id = $1
                    """,
                    offer_id,
                    cat_name,
                    type_name,
                    json.dumps(
                        {
                            "ozon_current_price": prices.get("price", 0),
                            "ozon_min_price": prices.get("min_price", 0),
                            "ozon_old_price": prices.get("old_price", 0),
                            "ozon_marketing_seller_price": prices.get("marketing_seller_price", 0),
                            "ozon_acquiring_rub": prices.get("acquiring_rub", 0),
                            "ozon_fbo_last_mile_rub": prices.get("fbo_last_mile_rub", 0),
                            "ozon_fbo_pipeline_min_rub": prices.get("fbo_pipeline_min_rub", 0),
                            "ozon_fbo_pipeline_max_rub": prices.get("fbo_pipeline_max_rub", 0),
                            "ozon_fbo_return_flow_rub": prices.get("fbo_return_flow_rub", 0),
                            "ozon_fbo_commission_pct": prices.get("fbo_commission_pct", 0),
                        }
                    ),
                    user_id,
                )
                if "UPDATE 1" in str(result):
                    synced += 1

            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed",
                rows_processed=len(products),
                created_count=synced,
                skipped_count=len(products) - synced,
                error_count=0,
                details={
                    "categories_mapped": categories_mapped,
                    "total_prices": len(price_map),
                    "unmapped_sample": unmapped[:20],
                },
            )

    return {
        "synced": synced,
        "categories_mapped": categories_mapped,
        "unmapped": unmapped[:20],
        "total_products": len(products),
        "total_prices": len(price_map),
    }


# ---------------------------------------------------------------------------
# 6. GET /pricing/products — all products with pricing enrichment
# ---------------------------------------------------------------------------


PRICING_SORT_FIELDS = {"title", "sku", "cogs", "ozon_price", "ozon_min_price"}

PRICING_SORT_MAP = {
    "title": "mc.title",
    "sku": "mc.sku",
    "cogs": "cogs",
    "ozon_price": "ozon_price_val",
    "ozon_min_price": "ozon_min_price_val",
}


@router.get("/pricing/products")
async def get_pricing_products(
    request: Request,
    lq: ListQuery = Depends(
        list_query_dep(allowed_sort=PRICING_SORT_FIELDS, default_sort="title:asc")
    ),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    pool = get_db_pool(request)
    user_id = str(user["id"])

    wb = WhereBuilder()
    wb.exact("mc.user_id", user_id)
    wb.not_equal("mc.status", "archived")
    wb.ilike_multi(["mc.title", "mc.sku", "mc.ozon_offer_id"], lq.q)

    where_sql, params = wb.build()

    async with pool.acquire() as conn:
        # 1. Count
        total_row = await safe_fetchone(
            conn,
            f"SELECT COUNT(*) AS total FROM master_cards mc {where_sql}",
            *params,
        )
        total = int(total_row["total"]) if total_row else 0

        if total == 0:
            return list_response([], 0, lq, defaults=_pricing_defaults())

        # 2. Cards + FIFO COGS in one query (GROUP BY mc.id)
        sort_col = PRICING_SORT_MAP[lq.sort_field]
        limit_idx = len(params) + 1
        offset_idx = len(params) + 2

        cards = await safe_fetch(
            conn,
            f"""
            SELECT mc.id, mc.sku, mc.title, mc.ozon_offer_id, mc.ozon_product_id,
                   mc.attributes, mc.ozon_category_name, mc.ozon_product_type_name,
                   COALESCE(
                       SUM(il.remaining_qty * il.unit_cost_rub)
                       / NULLIF(SUM(il.remaining_qty), 0),
                       0
                   ) AS cogs,
                   COALESCE((mc.attributes->>'ozon_current_price')::float, 0) AS ozon_price_val,
                   COALESCE((mc.attributes->>'ozon_min_price')::float, 0) AS ozon_min_price_val
            FROM master_cards mc
            LEFT JOIN inventory_lots il
                ON il.master_card_id = mc.id AND il.remaining_qty > 0
            {where_sql}
            GROUP BY mc.id
            ORDER BY {sort_col} {lq.sort_dir}
            LIMIT ${limit_idx} OFFSET ${offset_idx}
            """,
            *params,
            lq.limit,
            lq.offset,
        )

        # 3. Commission tiers per category/type (batch fetch FBO)
        cat_type_pairs = set()
        for c in cards:
            cn = c.get("ozon_category_name")
            tn = c.get("ozon_product_type_name")
            if cn and tn:
                cat_type_pairs.add((cn, tn))

        commission_cache: dict[tuple[str, str], list[dict]] = {}
        for cn, tn in cat_type_pairs:
            tiers = await _load_commission_tiers(conn, cn, tn, "FBO")
            if tiers:
                commission_cache[(cn, tn)] = tiers

    # 4. Assemble response
    items = []
    for c in cards:
        card_id = str(c["id"])
        sku = c["sku"] or ""
        cogs = float(c["cogs"] or 0)

        # Parse attributes
        attrs = c["attributes"] or {}
        if isinstance(attrs, str):
            try:
                attrs = json.loads(attrs)
            except Exception:
                attrs = {}

        # Prices from synced attributes
        ozon_price = float(attrs.get("ozon_current_price") or 0)
        ozon_min_price = float(attrs.get("ozon_min_price") or 0)
        ozon_old_price = float(attrs.get("ozon_old_price") or 0)

        # Category and commission tiers
        cat_name = c.get("ozon_category_name") or ""
        type_name = c.get("ozon_product_type_name") or ""
        tiers = commission_cache.get((cat_name, type_name), [])

        items.append(
            {
                "id": card_id,
                "sku": sku,
                "title": c["title"],
                "ozon_offer_id": c["ozon_offer_id"],
                "cogs": round(cogs, 2) if cogs else None,
                "ozon_price": round(ozon_price, 2) if ozon_price else None,
                "ozon_min_price": round(ozon_min_price, 2) if ozon_min_price else None,
                "ozon_old_price": round(ozon_old_price, 2) if ozon_old_price else None,
                "ozon_category_name": cat_name or None,
                "ozon_product_type_name": type_name or None,
                "commission_tiers": tiers,
                "tariffs": {
                    "acquiring_rub": float(attrs.get("ozon_acquiring_rub") or 0),
                    "last_mile_rub": float(attrs.get("ozon_fbo_last_mile_rub") or 0),
                    "pipeline_min_rub": float(attrs.get("ozon_fbo_pipeline_min_rub") or 0),
                    "pipeline_max_rub": float(attrs.get("ozon_fbo_pipeline_max_rub") or 0),
                    "return_flow_rub": float(attrs.get("ozon_fbo_return_flow_rub") or 0),
                    "fbo_commission_pct": float(attrs.get("ozon_fbo_commission_pct") or 0),
                    "marketing_seller_price": float(attrs.get("ozon_marketing_seller_price") or 0),
                },
            }
        )

    return list_response(items, total, lq, defaults=_pricing_defaults())


def _pricing_defaults() -> dict[str, float]:
    return {}


# ---------------------------------------------------------------------------
# 7. POST /pricing/set-prices — push prices to Ozon
# ---------------------------------------------------------------------------


@router.post("/pricing/set-prices")
async def set_prices(
    payload: SetPricesRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Push price/min_price/old_price to Ozon for one or more products."""
    pool = get_db_pool(request)
    user_id = str(user["id"])

    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn, admin_user_id=user_id, client_id=None, api_key=None
        )

    # Collect offer_ids that need current price filled in
    need_price_offers = [
        u.offer_id for u in payload.updates if u.min_price is not None and u.price is None
    ]
    current_prices: dict[str, float] = {}
    if need_price_offers:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT ozon_offer_id,
                       (attributes->>'ozon_current_price')::float AS cur_price
                FROM master_cards
                WHERE user_id = $1 AND ozon_offer_id = ANY($2::text[])
                """,
                user_id,
                need_price_offers,
            )
            for r in rows:
                if r["cur_price"]:
                    current_prices[r["ozon_offer_id"]] = r["cur_price"]

    # Build Ozon prices payload
    ozon_prices = []
    for u in payload.updates:
        entry: dict[str, Any] = {"offer_id": u.offer_id}
        if u.price is not None:
            entry["price"] = str(u.price)
        elif u.offer_id in current_prices:
            # Ozon requires price when setting min_price
            entry["price"] = str(current_prices[u.offer_id])
        if u.min_price is not None:
            entry["min_price"] = str(u.min_price)
        if u.old_price is not None:
            entry["old_price"] = str(u.old_price)
        ozon_prices.append(entry)

    if not ozon_prices:
        return {"updated": 0}

    result = await ozon_post(
        "/v1/product/import/prices",
        {"prices": ozon_prices},
        client_id=client_id,
        api_key=api_key,
    )

    ozon_result = result.get("result", [])
    # Build set of offer_ids that Ozon confirmed as updated
    ok_offers = {str(r.get("offer_id", "")) for r in ozon_result if r.get("updated")}

    # Only update local DB for successfully updated items
    updates_by_offer = {u.offer_id: u for u in payload.updates}
    async with pool.acquire() as conn:
        for offer_id in ok_offers:
            u = updates_by_offer.get(offer_id)
            if not u:
                continue
            price_attrs: dict[str, Any] = {}
            if u.price is not None:
                price_attrs["ozon_current_price"] = u.price
            if u.min_price is not None:
                price_attrs["ozon_min_price"] = u.min_price
            if u.old_price is not None:
                price_attrs["ozon_old_price"] = u.old_price
            if price_attrs:
                await conn.execute(
                    """
                    UPDATE master_cards SET attributes = attributes || $2::jsonb, updated_at = NOW()
                    WHERE user_id = $3 AND ozon_offer_id = $1
                    """,
                    u.offer_id,
                    json.dumps(price_attrs),
                    user_id,
                )

    errors = [r for r in ozon_result if not r.get("updated")]
    return {
        "updated": len(ok_offers),
        "succeeded": list(ok_offers),
        "errors": [{"offer_id": r.get("offer_id"), "errors": r.get("errors")} for r in errors],
    }
