from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import asyncpg
import httpx
from fastapi import HTTPException
from proxy.src.routes.admin_helpers import (
    _get_admin_ozon_creds,
    _safe_execute,
    _safe_fetchone,
    _to_decimal_for_json,
)
from proxy.src.services.admin_logic import (
    extract_ozon_products_cursor,
    parse_ozon_products,
)

logger = logging.getLogger(__name__)


async def resolve_ozon_creds(
    conn: asyncpg.Connection,
    *,
    admin_user_id: str,
    client_id: str | None,
    api_key: str | None,
) -> tuple[str, str]:
    resolved_client = (
        client_id.strip() if isinstance(client_id, str) and client_id.strip() else None
    )
    resolved_key = api_key.strip() if isinstance(api_key, str) and api_key.strip() else None

    if not resolved_client or not resolved_key:
        stored_client, stored_key = await _get_admin_ozon_creds(conn, admin_user_id)
        resolved_client = resolved_client or stored_client
        resolved_key = resolved_key or stored_key

    if not resolved_client or not resolved_key:
        raise HTTPException(
            status_code=400,
            detail=(
                "Ozon credentials are required. "
                "Set personal credentials in Admin UI (Integrations -> Ozon) "
                "or pass them in the request body."
            ),
        )
    return resolved_client, resolved_key


async def ozon_post(
    path: str,
    body: dict[str, Any],
    *,
    client_id: str,
    api_key: str,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    url = f"https://api-seller.ozon.ru{path}"
    headers = {
        "Client-Id": client_id,
        "Api-Key": api_key,
        "Content-Type": "application/json",
    }
    if http_client is None:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(url, headers=headers, json=body)
    else:
        response = await http_client.post(url, headers=headers, json=body)
    if response.status_code >= 400:
        detail = response.text[:2000]
        raise HTTPException(
            status_code=response.status_code, detail=f"Ozon API error on {path}: {detail}"
        )
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Invalid JSON from Ozon path {path}") from exc


def is_ozon_endpoint_not_found(detail: str) -> bool:
    detail_lower = str(detail).lower()
    return "404 page not found" in detail_lower or "status code 404" in detail_lower


def safe_parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return datetime.now(tz=timezone.utc)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(tz=timezone.utc)


async def load_ozon_products(
    *,
    client_id: str,
    api_key: str,
    page_size: int,
    max_pages: int,
    visibility: str = "ALL",
    http_client: httpx.AsyncClient | None = None,
) -> tuple[list[dict[str, Any]], str]:
    def is_generic_title(title: Any) -> bool:
        text = str(title or "").strip()
        if not text:
            return True
        return text.startswith("Товар ") or text.lower().startswith("product ")

    def merge_info(base: list[dict[str, Any]], info: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_product_id: dict[str, dict[str, Any]] = {
            str(item["product_id"]): item for item in info if item.get("product_id")
        }
        by_offer_id: dict[str, dict[str, Any]] = {
            str(item["offer_id"]): item for item in info if item.get("offer_id")
        }

        for item in base:
            info_item: dict[str, Any] | None = None
            if item.get("product_id"):
                info_item = by_product_id.get(str(item["product_id"]))
            if not info_item and item.get("offer_id"):
                info_item = by_offer_id.get(str(item["offer_id"]))
            if not info_item:
                continue

            # Prefer real Ozon name over fallback "Товар <id>".
            if (
                is_generic_title(item.get("title"))
                and info_item.get("title")
                and not is_generic_title(info_item.get("title"))
            ):
                item["title"] = info_item["title"]

            # Prefer concrete sku if list endpoint returned only offer_id/product_id.
            if info_item.get("sku") and (
                not item.get("sku") or item["sku"] in {item.get("offer_id"), item.get("product_id")}
            ):
                item["sku"] = info_item["sku"]

            # Fill images/dimensions from info endpoint when missing.
            if info_item.get("images") and (
                not isinstance(item.get("images"), list) or not item["images"]
            ):
                item["images"] = info_item["images"]
            pid = item.get("product_id") or item.get("offer_id") or "?"
            info_dims = (
                info_item.get("dimensions") if isinstance(info_item.get("dimensions"), dict) else {}
            )
            list_dims = item.get("dimensions") if isinstance(item.get("dimensions"), dict) else {}
            if info_dims or list_dims:
                logger.info(
                    "Ozon dimension enrichment for %s: list_dims=%s, info_dims=%s",
                    pid,
                    list_dims,
                    info_dims,
                )
            if isinstance(info_item.get("dimensions"), dict):
                current_dims = (
                    item.get("dimensions") if isinstance(item.get("dimensions"), dict) else {}
                )
                for key, value in info_item["dimensions"].items():
                    if current_dims.get(key) in (None, "", 0, 0.0):
                        current_dims[key] = value
                item["dimensions"] = current_dims

            # Keep raw snapshots from both endpoints for traceability.
            raw_list = item.get("raw") if isinstance(item.get("raw"), dict) else None
            raw_info = info_item.get("raw") if isinstance(info_item.get("raw"), dict) else None
            if raw_list and raw_info:
                item["raw"] = {"list": raw_list, "info": raw_info}
            elif raw_info:
                item["raw"] = raw_info

        return base

    endpoints = ("/v2/product/list", "/v3/product/list")
    last_exception: HTTPException | None = None

    for endpoint in endpoints:
        try:
            cursor = ""
            parsed_products: list[dict[str, Any]] = []
            for _ in range(max_pages):
                request_body = {
                    "filter": {"visibility": visibility},
                    "last_id": cursor,
                    "limit": page_size,
                }
                payload = await ozon_post(
                    endpoint,
                    request_body,
                    client_id=client_id,
                    api_key=api_key,
                    http_client=http_client,
                )
                batch = parse_ozon_products(payload)
                if not batch:
                    break
                # /v3/product/list returns only ids/quants, without name/dimensions.
                # Enrich batch with product attributes to pull dimensions and real name.
                if endpoint == "/v3/product/list":
                    product_ids: list[int] = []
                    for item in batch:
                        value = item.get("product_id")
                        if not value:
                            continue
                        try:
                            product_ids.append(int(str(value)))
                        except (ValueError, TypeError):
                            continue
                    if product_ids:
                        attrs_payload = await ozon_post(
                            "/v4/product/info/attributes",
                            {"filter": {"product_id": product_ids}, "limit": len(product_ids)},
                            client_id=client_id,
                            api_key=api_key,
                            http_client=http_client,
                        )
                        info_batch = parse_ozon_products(attrs_payload)
                        batch = merge_info(batch, info_batch)
                parsed_products.extend(batch)

                next_cursor = extract_ozon_products_cursor(payload)
                if not next_cursor or next_cursor == cursor:
                    if len(batch) < page_size:
                        break
                    # Fallback stop if response does not provide cursor pagination.
                    break
                cursor = next_cursor
            return parsed_products, endpoint
        except HTTPException as exc:
            last_exception = exc
            continue

    if last_exception:
        raise last_exception
    return [], endpoints[0]


async def create_sync_run(
    conn: asyncpg.Connection,
    *,
    sync_type: str,
    user_id: str,
) -> str:
    row = await _safe_fetchone(
        conn,
        """
        INSERT INTO ozon_sync_runs (sync_type, user_id)
        VALUES ($1, $2)
        RETURNING id
        """,
        sync_type,
        user_id,
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create sync run")
    return str(row["id"])


async def finish_sync_run(
    conn: asyncpg.Connection,
    *,
    run_id: str,
    status_text: str,
    rows_processed: int,
    created_count: int,
    skipped_count: int,
    error_count: int,
    details: dict[str, Any],
) -> None:
    await _safe_execute(
        conn,
        """
        UPDATE ozon_sync_runs
        SET finished_at = NOW(),
            status = $2,
            rows_processed = $3,
            created_count = $4,
            skipped_count = $5,
            error_count = $6,
            details = $7
        WHERE id = $1
        """,
        run_id,
        status_text,
        rows_processed,
        created_count,
        skipped_count,
        error_count,
        json.dumps(_to_decimal_for_json(details)),
    )
