from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
from typing import Any

import asyncpg
from fastapi import HTTPException
from proxy.src.repositories.admin import card_repo
from proxy.src.routes.admin.list_query import ListQuery, list_response
from proxy.src.routes.admin.serialization import parse_jsonb, record_to_dict, rows_to_dicts
from proxy.src.services.admin.tmapi_client import fetch_1688_item, parse_tmapi_1688_item

logger = logging.getLogger(__name__)


def _coerce_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        parsed = float(str(value).strip())
        if parsed <= 0:
            return None
        return round(parsed, 3)
    except (ValueError, TypeError):
        return None


def _merge_dimensions(
    attributes: dict[str, Any] | None,
    dimensions: dict[str, Any],
    *,
    overwrite: bool = False,
) -> dict[str, Any]:
    safe_attributes = dict(attributes) if isinstance(attributes, dict) else {}
    current = safe_attributes.get("dimensions")
    if not isinstance(current, dict):
        current = {}
    for key, value in dimensions.items():
        normalized = _coerce_float(value)
        if normalized is None:
            continue
        if overwrite or current.get(key) in (None, "", 0, 0.0):
            current[key] = normalized
    safe_attributes["dimensions"] = current
    return safe_attributes


def _source_key(provider: str, external_ref: str | None) -> str:
    ref = (external_ref or provider).strip().lower()
    digest = sha256(ref.encode("utf-8")).hexdigest()[:12]
    return f"{provider}:{digest}"


def _to_decimal_for_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _to_decimal_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimal_for_json(v) for v in value]
    return value


def merge_card_source(
    *,
    attributes: dict[str, Any] | None,
    source_key: str,
    source_kind: str,
    provider: str,
    external_ref: str | None,
    data: dict[str, Any],
    raw_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_attributes = dict(attributes) if isinstance(attributes, dict) else {}
    sources = safe_attributes.get("sources")
    if not isinstance(sources, dict):
        sources = {}
    merged_source: dict[str, Any] = {
        "kind": source_kind,
        "provider": provider,
        "external_ref": external_ref,
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data": data,
    }
    if raw_payload is not None:
        merged_source["raw_payload"] = raw_payload
    sources[source_key] = merged_source
    safe_attributes["sources"] = sources
    return safe_attributes


# ---- Card CRUD ----


async def list_cards(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    lq: ListQuery,
    include_archived: bool,
) -> dict[str, Any]:
    rows, total = await card_repo.list_cards(
        conn, user_id=user_id, lq=lq, include_archived=include_archived
    )
    return list_response(rows_to_dicts(rows), total, lq)


async def get_card_detail(
    conn: asyncpg.Connection, *, card_id: str, user_id: str
) -> dict[str, Any]:
    card = await card_repo.get_card(conn, card_id=card_id, user_id=user_id)
    if not card:
        raise HTTPException(status_code=404, detail="Master card not found")
    lots = await card_repo.get_card_lots(conn, card_id=card_id)
    sales = await card_repo.get_card_sales(conn, card_id=card_id)
    return {
        "item": record_to_dict(card),
        "lots": rows_to_dicts(lots),
        "sales": rows_to_dicts(sales),
    }


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
) -> dict[str, Any]:
    row = await card_repo.create_card(
        conn,
        user_id=user_id,
        sku=sku,
        title=title,
        description=description,
        brand=brand,
        ozon_product_id=ozon_product_id,
        ozon_offer_id=ozon_offer_id,
        status=status,
        attributes=attributes,
    )
    return {"item": record_to_dict(row)}


async def update_card(
    conn: asyncpg.Connection,
    *,
    card_id: str,
    user_id: str,
    fields: dict[str, Any],
) -> dict[str, Any]:
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    row = await card_repo.update_card(conn, card_id=card_id, user_id=user_id, fields=fields)
    if not row:
        raise HTTPException(status_code=404, detail="Master card not found")
    return {"item": record_to_dict(row)}


# ---- 1688 Preview/Import ----


async def preview_1688(url: str) -> dict[str, Any]:
    tmapi_payload = await fetch_1688_item(url)
    source_snapshot = parse_tmapi_1688_item(tmapi_payload)
    if not source_snapshot:
        raise HTTPException(status_code=422, detail="Could not parse TMAPI payload")
    return {
        "title": source_snapshot.get("title"),
        "item_id": source_snapshot.get("item_id"),
        "url": source_snapshot.get("url"),
        "supplier_name": source_snapshot.get("supplier_name"),
        "images": source_snapshot.get("images") or [],
        "skus": source_snapshot.get("skus") or [],
        "dimensions": source_snapshot.get("dimensions") or {},
        "price_min": source_snapshot.get("price_min"),
        "price_max": source_snapshot.get("price_max"),
    }


async def import_1688(
    conn: asyncpg.Connection,
    *,
    card_id: str,
    user_id: str,
    url: str,
    scene: str | None,
    optimize_title: bool | None,
    overwrite_title: bool,
    overwrite_dimensions: bool,
    selected_sku_id: str | None,
    selected_sku_price: float | None,
) -> dict[str, Any]:
    tmapi_payload = await fetch_1688_item(url, scene=scene, optimize_title=optimize_title)
    source_snapshot = parse_tmapi_1688_item(tmapi_payload)
    logger.info(
        "1688 import: url=%s, parsed_title=%s, sku_count=%s, price_min=%s",
        url,
        source_snapshot.get("title"),
        len(source_snapshot.get("skus") or []),
        source_snapshot.get("price_min"),
    )
    if not source_snapshot:
        raise HTTPException(status_code=422, detail="Could not parse TMAPI payload")

    card = await card_repo.get_card_raw(conn, card_id=card_id, user_id=user_id)
    if not card:
        raise HTTPException(status_code=404, detail="Master card not found")

    current_attrs = parse_jsonb(card["attributes"])
    sk = _source_key(
        "1688", source_snapshot.get("url") or source_snapshot.get("item_id") or card_id
    )

    source_data: dict[str, Any] = {
        "title": source_snapshot.get("title"),
        "item_id": source_snapshot.get("item_id"),
        "url": source_snapshot.get("url"),
        "supplier_name": source_snapshot.get("supplier_name"),
        "images": source_snapshot.get("images") or [],
        "price_min": source_snapshot.get("price_min"),
        "price_max": source_snapshot.get("price_max"),
    }
    if selected_sku_id:
        source_data["selected_sku_id"] = selected_sku_id
    if selected_sku_price is not None:
        source_data["selected_sku_price"] = selected_sku_price
        source_data["price_min"] = str(selected_sku_price)
        source_data["price_max"] = str(selected_sku_price)

    merged_attrs = merge_card_source(
        attributes=current_attrs,
        source_key=sk,
        source_kind="supplier",
        provider="1688",
        external_ref=source_snapshot.get("url") or source_snapshot.get("item_id"),
        data=source_data,
        raw_payload=source_snapshot.get("raw")
        if isinstance(source_snapshot.get("raw"), dict)
        else None,
    )

    purchase_price = selected_sku_price
    if purchase_price is None:
        pm = source_snapshot.get("price_min")
        if pm is not None:
            try:
                purchase_price = float(str(pm))
            except (ValueError, TypeError):
                pass
    if purchase_price is not None:
        merged_attrs["purchase"] = {"price": purchase_price, "currency": "CNY"}

    card_title = card["title"]
    if overwrite_title and source_snapshot.get("title"):
        card_title = source_snapshot["title"]

    dims = source_snapshot.get("dimensions")
    merged_attrs = _merge_dimensions(
        merged_attrs,
        dims if isinstance(dims, dict) else {},
        overwrite=overwrite_dimensions,
    )

    updated = await card_repo.update_card(
        conn,
        card_id=card_id,
        user_id=user_id,
        fields={
            "title": card_title,
            "attributes": _to_decimal_for_json(merged_attrs),
        },
    )
    return {"item": record_to_dict(updated), "source": source_snapshot}
