from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

import httpx
from fastapi import HTTPException
from proxy.src.config import settings

MONEY_QUANT = Decimal("0.01")


def _to_money(value: Any) -> Decimal:
    if isinstance(value, Decimal):
        return value.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    try:
        return Decimal(str(value or 0)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _to_float_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(str(value).strip())
        if number <= 0:
            return None
        return round(number, 3)
    except (ValueError, TypeError):
        return None


async def fetch_1688_item(
    url: str, *, scene: str | None = None, optimize_title: bool | None = None
) -> dict[str, Any]:
    token = settings.tmapi_api_token
    if not token:
        raise HTTPException(status_code=503, detail="TMAPI (1688) is not configured")

    query_params: dict[str, str] = {"apiToken": token}
    body: dict[str, Any] = {"url": url.strip()}
    if scene:
        body["scene"] = scene
    if optimize_title is not None:
        body["optimize_title"] = optimize_title

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            "https://api.tmapi.top/1688/item_detail_by_url",
            params=query_params,
            json=body,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code, detail=f"TMAPI error: {response.text[:800]}"
        )

    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="TMAPI returned invalid JSON") from exc


def parse_tmapi_1688_item(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}

    data = payload.get("data")
    root = data if isinstance(data, dict) else payload

    item_candidates = [root]
    for key in ("item", "result", "offer", "product"):
        nested = root.get(key) if isinstance(root, dict) else None
        if isinstance(nested, dict):
            item_candidates.insert(0, nested)

    item: dict[str, Any] = {}
    for candidate in item_candidates:
        if not isinstance(candidate, dict):
            continue
        if any(
            key in candidate
            for key in (
                "title",
                "subject",
                "name",
                "item_id",
                "itemId",
                "images",
                "imgUrls",
                "skuMap",
                "skuProps",
            )
        ):
            item = candidate
            break
    if not item and isinstance(root, dict):
        item = root

    title = (
        str(
            item.get("title")
            or item.get("subject")
            or item.get("name")
            or item.get("itemTitle")
            or ""
        ).strip()
        or None
    )
    item_id = str(item.get("item_id") or item.get("itemId") or item.get("id") or "").strip() or None
    offer_url = str(item.get("url") or item.get("itemUrl") or root.get("url") or "").strip() or None

    supplier_name = (
        str(
            item.get("company_name")
            or item.get("companyName")
            or item.get("seller_name")
            or item.get("sellerName")
            or item.get("shop_name")
            or item.get("shopName")
            or ""
        ).strip()
        or None
    )

    images: list[str] = []
    for key in ("images", "imgUrls", "imageList", "detailImageList"):
        values = item.get(key)
        if isinstance(values, list):
            for value in values:
                if value:
                    image_url = str(value).strip()
                    if image_url and image_url not in images:
                        images.append(image_url)
    main_image = item.get("mainImage") or item.get("main_image") or item.get("image")
    if main_image:
        image_url = str(main_image).strip()
        if image_url and image_url not in images:
            images.insert(0, image_url)

    normalized: dict[str, Any] = {
        "title": title,
        "item_id": item_id,
        "url": offer_url,
        "supplier_name": supplier_name,
        "images": images,
        "sku_count": len(item.get("skuMap") or item.get("skuProps") or []),
        "dimensions": {
            key: value
            for key, value in {
                "package_length_cm": _to_float_or_none(
                    item.get("length") or item.get("packageLength")
                ),
                "package_width_cm": _to_float_or_none(
                    item.get("width") or item.get("packageWidth")
                ),
                "package_height_cm": _to_float_or_none(
                    item.get("height") or item.get("packageHeight")
                ),
                "package_weight_kg": _to_float_or_none(
                    item.get("weight") or item.get("packageWeight")
                ),
            }.items()
            if value is not None
        },
        "raw": payload,
    }

    prices: list[Decimal] = []
    for price_key in ("price", "priceMin", "priceMax", "price_min", "price_max"):
        value = item.get(price_key)
        try:
            if value is not None:
                prices.append(_to_money(value))
        except Exception:
            pass
    price_info = item.get("price_info")
    if isinstance(price_info, dict):
        for pk in ("price_min", "price_max", "price", "origin_price_min", "origin_price_max"):
            pv = price_info.get(pk)
            try:
                if pv is not None and str(pv).strip():
                    prices.append(_to_money(pv))
            except Exception:
                pass
    if prices:
        normalized["price_min"] = str(min(prices))
        normalized["price_max"] = str(max(prices))

    normalized["skus"] = _parse_tmapi_1688_skus(item)
    return normalized


def _parse_tmapi_1688_skus(item: dict[str, Any]) -> list[dict[str, Any]]:
    sku_map_raw = item.get("skuMap") or item.get("sku_map")
    sku_props_raw = item.get("skuProps") or item.get("sku_props") or item.get("skuInfoMap")

    prop_images: dict[str, str] = {}
    prop_names: list[dict[str, Any]] = []
    if isinstance(sku_props_raw, list):
        for prop in sku_props_raw:
            if not isinstance(prop, dict):
                continue
            prop_name = str(
                prop.get("propName")
                or prop.get("prop_name")
                or prop.get("prop")
                or prop.get("name")
                or ""
            ).strip()
            values_list: list[dict[str, Any]] = []
            for val in prop.get("values") or prop.get("value") or []:
                if not isinstance(val, dict):
                    continue
                val_name = str(val.get("name") or val.get("value") or "").strip()
                val_image = (
                    str(val.get("imageUrl") or val.get("image") or val.get("img") or "").strip()
                    or None
                )
                if val_name:
                    values_list.append({"name": val_name, "image": val_image})
                    if val_image:
                        prop_images[val_name] = val_image
            prop_names.append({"propName": prop_name, "values": values_list})

    skus: list[dict[str, Any]] = []

    if isinstance(sku_map_raw, dict):
        for combo_key, sku_data in sku_map_raw.items():
            if not isinstance(sku_data, dict):
                continue
            sku_id = str(
                sku_data.get("skuId") or sku_data.get("sku_id") or sku_data.get("id") or combo_key
            ).strip()
            price = None
            for pk in ("price", "salePrice", "discountPrice", "originalPrice"):
                pv = sku_data.get(pk)
                if pv is not None:
                    try:
                        price = float(str(pv))
                        break
                    except (ValueError, TypeError):
                        pass
            stock = None
            for sk in ("canBookCount", "stock", "quantity", "amountOnSale"):
                sv = sku_data.get(sk)
                if sv is not None:
                    try:
                        stock = int(float(str(sv)))
                        break
                    except (ValueError, TypeError):
                        pass
            parts = [p.strip() for p in combo_key.replace("&gt;", ">").split(">") if p.strip()]
            name = " / ".join(parts) if parts else combo_key
            image = None
            for part in parts:
                if part in prop_images:
                    image = prop_images[part]
                    break
            skus.append(
                {
                    "sku_id": sku_id,
                    "name": name,
                    "image": image,
                    "price": price,
                    "stock": stock,
                    "props": parts,
                }
            )
    elif isinstance(sku_map_raw, list):
        for idx, sku_data in enumerate(sku_map_raw):
            if not isinstance(sku_data, dict):
                continue
            sku_id = str(
                sku_data.get("skuId") or sku_data.get("sku_id") or sku_data.get("id") or idx
            ).strip()
            price = None
            for pk in ("price", "salePrice", "discountPrice"):
                pv = sku_data.get(pk)
                if pv is not None:
                    try:
                        price = float(str(pv))
                        break
                    except (ValueError, TypeError):
                        pass
            name_parts: list[str] = []
            for pk in ("specAttrs", "props", "attributes"):
                pv = sku_data.get(pk)
                if isinstance(pv, str):
                    name_parts = [p.strip() for p in pv.replace("&gt;", ">").split(">")]
                    break
            name = (
                " / ".join(name_parts)
                if name_parts
                else str(sku_data.get("name") or f"SKU {idx + 1}")
            )
            image = None
            for part in name_parts:
                if part in prop_images:
                    image = prop_images[part]
                    break
            skus.append(
                {
                    "sku_id": sku_id,
                    "name": name,
                    "image": image
                    or str(sku_data.get("imageUrl") or sku_data.get("image") or "").strip()
                    or None,
                    "price": price,
                    "stock": None,
                    "props": name_parts,
                }
            )

    if not skus:
        skus_array = item.get("skus")
        if isinstance(skus_array, list):
            for idx, sku_data in enumerate(skus_array):
                if not isinstance(sku_data, dict):
                    continue
                sku_id = str(
                    sku_data.get("skuid") or sku_data.get("skuId") or sku_data.get("sku_id") or idx
                ).strip()
                price = None
                for pk in ("sale_price", "price", "salePrice", "discountPrice"):
                    pv = sku_data.get(pk)
                    if pv is not None:
                        try:
                            price = float(str(pv))
                            break
                        except (ValueError, TypeError):
                            pass
                stock_val = None
                sv = sku_data.get("stock")
                if sv is not None:
                    try:
                        stock_val = int(float(str(sv)))
                    except (ValueError, TypeError):
                        pass
                props_str = str(
                    sku_data.get("props_names") or sku_data.get("propsNames") or ""
                ).strip()
                name_parts = []
                if props_str:
                    for segment in props_str.split(";"):
                        segment = segment.strip()
                        if ":" in segment:
                            val_part = segment.split(":", 1)[1].strip()
                            if val_part:
                                name_parts.append(val_part)
                        elif segment:
                            name_parts.append(segment)
                name = (
                    " / ".join(name_parts)
                    if name_parts
                    else str(sku_data.get("name") or f"SKU {idx + 1}")
                )
                image = None
                for part in name_parts:
                    if part in prop_images:
                        image = prop_images[part]
                        break
                skus.append(
                    {
                        "sku_id": sku_id,
                        "name": name,
                        "image": image
                        or str(sku_data.get("imageUrl") or sku_data.get("image") or "").strip()
                        or None,
                        "price": price,
                        "stock": stock_val,
                        "props": name_parts,
                    }
                )

    if not skus and prop_names:
        for prop_group in prop_names:
            for val in prop_group.get("values") or []:
                skus.append(
                    {
                        "sku_id": val["name"],
                        "name": val["name"],
                        "image": val.get("image"),
                        "price": None,
                        "stock": None,
                        "props": [val["name"]],
                    }
                )

    return skus
