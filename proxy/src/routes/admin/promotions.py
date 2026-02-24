"""Promotions endpoints: price index with action toggles, timer management."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, Request
from proxy.src.repositories.admin.base import safe_fetch
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin_ozon import ozon_post, resolve_ozon_creds
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Promotions"])


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ActionUpdateItem(BaseModel):
    offer_id: str
    price: float | None = None
    auto_action_enabled: str | None = None  # "ENABLED" / "DISABLED"
    auto_add_to_ozon_actions_list_enabled: str | None = None  # "ENABLED" / "DISABLED"
    min_price: float | None = None


class UpdateActionsRequest(BaseModel):
    updates: list[ActionUpdateItem]


class RefreshTimersRequest(BaseModel):
    product_ids: list[int]


# ---------------------------------------------------------------------------
# 1. GET /promotions/price-index
# ---------------------------------------------------------------------------


@router.get("/promotions/price-index")
async def get_price_index(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch all products with prices, action toggles, timers from Ozon API."""
    pool = get_db_pool(request)
    user_id = str(user["id"])

    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn, admin_user_id=user_id, client_id=None, api_key=None
        )

    # 1. Fetch prices via /v5/product/info/prices (cursor pagination)
    all_items: list[dict] = []
    cursor = ""
    for _ in range(20):
        pdata = await ozon_post(
            "/v5/product/info/prices",
            {"filter": {"visibility": "ALL"}, "limit": 1000, "cursor": cursor},
            client_id=client_id,
            api_key=api_key,
        )
        items = pdata.get("items", [])
        if not items:
            break
        all_items.extend(items)
        cursor = pdata.get("cursor", "")
        if not cursor or len(items) < 1000:
            break

    if not all_items:
        return {"items": []}

    # 2. Fetch timer statuses
    product_ids = [it["product_id"] for it in all_items if it.get("product_id")]
    timer_map: dict[int, dict] = {}
    # Timer endpoint accepts up to 1000 product_ids
    for i in range(0, len(product_ids), 1000):
        chunk = product_ids[i : i + 1000]
        try:
            timer_data = await ozon_post(
                "/v1/product/action/timer/status",
                {"product_ids": chunk},
                client_id=client_id,
                api_key=api_key,
            )
            for s in timer_data.get("statuses", []):
                timer_map[s["product_id"]] = s
        except Exception:
            logger.warning("Failed to fetch timer status", exc_info=True)

    # 3. Enrich with title/sku from master_cards
    offer_ids = [str(it.get("offer_id", "")) for it in all_items if it.get("offer_id")]
    card_map: dict[str, dict] = {}
    if offer_ids:
        async with pool.acquire() as conn:
            rows = await safe_fetch(
                conn,
                """
                SELECT ozon_offer_id, ozon_product_id, title, sku
                FROM master_cards
                WHERE user_id = $1 AND ozon_offer_id = ANY($2::text[])
                """,
                user_id,
                offer_ids,
            )
            for r in rows:
                card_map[r["ozon_offer_id"]] = {
                    "title": r["title"],
                    "sku": r["sku"] or "",
                }

    # 4. Build response
    result = []
    for it in all_items:
        offer_id = str(it.get("offer_id", ""))
        product_id = it.get("product_id", 0)
        price_data = it.get("price", {})
        indexes = it.get("price_indexes", {})
        actions = it.get("marketing_actions", {}).get("actions", [])
        card = card_map.get(offer_id, {})
        timer = timer_map.get(product_id, {})

        result.append(
            {
                "offer_id": offer_id,
                "product_id": product_id,
                "title": card.get("title", offer_id),
                "sku": card.get("sku", ""),
                "price": float(price_data.get("price", 0) or 0),
                "min_price": float(price_data.get("min_price", 0) or 0),
                "old_price": float(price_data.get("old_price", 0) or 0),
                "marketing_seller_price": float(price_data.get("marketing_seller_price", 0) or 0),
                "auto_action_enabled": bool(price_data.get("auto_action_enabled")),
                "auto_add_to_ozon_actions_list_enabled": bool(
                    price_data.get("auto_add_to_ozon_actions_list_enabled")
                ),
                "color_index": indexes.get("color_index", "WITHOUT_INDEX"),
                "price_index_value": float(
                    (indexes.get("external_index_data") or {}).get("price_index_value", 0) or 0
                ),
                "actions_count": len(actions),
                "actions": [
                    {"title": a.get("title", ""), "value": a.get("value", 0)} for a in actions
                ],
                "timer_enabled": timer.get("min_price_for_auto_actions_enabled", False),
                "timer_expires_at": timer.get("expired_at"),
            }
        )

    return {"items": result}


# ---------------------------------------------------------------------------
# 2. POST /promotions/update-actions
# ---------------------------------------------------------------------------


@router.post("/promotions/update-actions")
async def update_actions(
    payload: UpdateActionsRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Update action toggles and min_price for products on Ozon."""
    pool = get_db_pool(request)
    user_id = str(user["id"])

    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn, admin_user_id=user_id, client_id=None, api_key=None
        )

    ozon_prices = []
    for u in payload.updates:
        entry: dict[str, Any] = {"offer_id": u.offer_id}
        # price is required by Ozon when updating any field
        if u.price is not None:
            entry["price"] = str(u.price)
        if u.auto_action_enabled is not None:
            entry["auto_action_enabled"] = u.auto_action_enabled
        if u.auto_add_to_ozon_actions_list_enabled is not None:
            entry["auto_add_to_ozon_actions_list_enabled"] = u.auto_add_to_ozon_actions_list_enabled
        if u.min_price is not None:
            entry["min_price"] = str(u.min_price)
        ozon_prices.append(entry)

    if not ozon_prices:
        return {"updated": 0, "errors": []}

    result = await ozon_post(
        "/v1/product/import/prices",
        {"prices": ozon_prices},
        client_id=client_id,
        api_key=api_key,
    )

    ozon_result = result.get("result", [])
    ok = [r for r in ozon_result if r.get("updated")]
    errors = [
        {"offer_id": r.get("offer_id"), "errors": r.get("errors")}
        for r in ozon_result
        if not r.get("updated")
    ]

    return {"updated": len(ok), "errors": errors}


# ---------------------------------------------------------------------------
# 3. POST /promotions/refresh-timers
# ---------------------------------------------------------------------------


@router.post("/promotions/refresh-timers")
async def refresh_timers(
    payload: RefreshTimersRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Reset min_price timer to 30 days for given products."""
    pool = get_db_pool(request)
    user_id = str(user["id"])

    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn, admin_user_id=user_id, client_id=None, api_key=None
        )

    if not payload.product_ids:
        return {"success": True}

    await ozon_post(
        "/v1/product/action/timer/update",
        {"product_ids": payload.product_ids},
        client_id=client_id,
        api_key=api_key,
    )

    return {"success": True}
