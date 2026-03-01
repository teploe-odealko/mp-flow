from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from proxy.src.repositories.admin import stock_repo
from proxy.src.routes.admin.deps import get_current_user, get_db_pool, require_admin
from proxy.src.routes.admin.response_models import SyncFreshnessResponse, SyncResultResponse
from proxy.src.routes.admin_helpers import (
    _date_windows,
    _merge_dimensions,
    _parse_jsonb,
    _safe_execute,
    _safe_fetch,
    _safe_fetchone,
    _source_key,
    _to_decimal_for_json,
)
from proxy.src.routes.admin_models import (
    OzonProductsImportRequest,
    OzonStocksRequest,
    OzonSupplySyncRequest,
    OzonSyncRequest,
    OzonWarehouseStockSyncRequest,
)
from proxy.src.routes.admin_ozon import (
    create_sync_run,
    finish_sync_run,
    load_ozon_products,
    ozon_post,
    resolve_ozon_creds,
    safe_parse_datetime,
)
from proxy.src.services.admin.fifo_service import reverse_fifo_allocations
from proxy.src.services.admin.sales_service import create_sale
from proxy.src.services.admin_logic import (
    merge_card_source,
    parse_ozon_cluster_stock,
    parse_ozon_finance_transactions,
    parse_ozon_operation_economics,
    to_money,
    to_qty,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Ozon Sync"])


# ---------------------------------------------------------------------------
# GET /ozon/sync/freshness
# ---------------------------------------------------------------------------


@router.get("/ozon/sync/freshness", response_model=SyncFreshnessResponse)
async def get_sync_freshness(
    request: Request,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Return last successful sync time per sync_type for the current user."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        rows = await _safe_fetch(
            conn,
            """
            SELECT sync_type,
                   MAX(finished_at) AS last_synced_at
            FROM ozon_sync_runs
            WHERE user_id = $1 AND status LIKE 'completed%'
            GROUP BY sync_type
            """,
            str(admin["id"]),
        )
    result: dict[str, str | None] = {}
    for r in rows:
        ts = r["last_synced_at"]
        result[r["sync_type"]] = ts.isoformat() if ts else None
    return {"sync_types": result}


# ---------------------------------------------------------------------------
# GET /ozon/sync/runs — latest run per sync_type with full detail
# ---------------------------------------------------------------------------


@router.get("/ozon/sync/runs")
async def get_sync_runs(
    request: Request,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Return latest sync run per sync_type with full detail."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        rows = await _safe_fetch(
            conn,
            """
            SELECT DISTINCT ON (sync_type)
                   sync_type, started_at, finished_at, status,
                   rows_processed, created_count, skipped_count, error_count, details
            FROM ozon_sync_runs
            WHERE user_id = $1
            ORDER BY sync_type, finished_at DESC NULLS LAST
            """,
            str(admin["id"]),
        )
    runs = []
    for r in rows:
        run = dict(r)
        for k in ("started_at", "finished_at"):
            if run.get(k):
                run[k] = run[k].isoformat()
        if isinstance(run.get("details"), str):
            try:
                run["details"] = json.loads(run["details"])
            except (json.JSONDecodeError, TypeError):
                pass
        runs.append(run)
    return {"runs": runs}


# ---------------------------------------------------------------------------
# POST /ozon/stocks
# ---------------------------------------------------------------------------


@router.post("/ozon/stocks", response_model=SyncResultResponse)
async def fetch_ozon_stocks(
    payload: OzonStocksRequest,
    request: Request,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Fetch current Ozon stock levels and match to master_cards."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=payload.client_id,
            api_key=payload.api_key,
        )

        uid = str(admin["id"])
        cards = await _safe_fetch(
            conn,
            """
            SELECT id, sku, title, ozon_product_id, ozon_offer_id
            FROM master_cards
            WHERE user_id = $1
              AND (ozon_offer_id IS NOT NULL OR ozon_product_id IS NOT NULL)
              AND status != 'archived'
            """,
            uid,
        )
        if not cards:
            return {
                "items": [],
                "message": "Нет карточек, привязанных к Ozon. Сначала импортируйте товары.",
            }

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
                    data = await ozon_post(
                        "/v4/product/info/stocks",
                        body,
                        client_id=client_id,
                        api_key=api_key,
                        http_client=ozon_client,
                    )
                except HTTPException:
                    logger.warning("Ozon /v4/product/info/stocks failed, skipping FBS")
                    break
                items = data.get("items", [])
                if not items:
                    break
                for si in items:
                    total_present = sum(s.get("present", 0) for s in (si.get("stocks") or []))
                    oid = str(si.get("offer_id", ""))
                    pid = str(si.get("product_id", ""))
                    if oid:
                        stock_by_offer[oid] = stock_by_offer.get(oid, 0) + total_present
                    if pid:
                        stock_by_product[pid] = stock_by_product.get(pid, 0) + total_present
                cursor = data.get("cursor", "")
                if not cursor or len(items) < 1000:
                    break

            try:
                fbo_data = await ozon_post(
                    "/v1/analytics/stocks",
                    {"limit": 1000, "offset": 0, "warehouse_type": "ALL"},
                    client_id=client_id,
                    api_key=api_key,
                    http_client=ozon_client,
                )
                for row in fbo_data.get("result", {}).get("rows", []):
                    oid = str(row.get("offer_id", ""))
                    pid = str(row.get("product_id", ""))
                    fbo_present = row.get("free_to_sell_amount", 0) or 0
                    if oid:
                        stock_by_offer[oid] = stock_by_offer.get(oid, 0) + fbo_present
                    if pid:
                        stock_by_product[pid] = stock_by_product.get(pid, 0) + fbo_present
            except HTTPException:
                logger.warning("Ozon /v1/analytics/stocks failed, using FBS only")

        matched: list[dict[str, Any]] = []
        for card in cards:
            offer_id = str(card["ozon_offer_id"] or "")
            product_id = str(card["ozon_product_id"] or "")
            stock = stock_by_offer.get(offer_id) or stock_by_product.get(product_id) or 0
            if stock <= 0:
                continue
            matched.append(
                {
                    "master_card_id": str(card["id"]),
                    "title": card["title"],
                    "sku": card["sku"],
                    "ozon_offer_id": card["ozon_offer_id"],
                    "stock_present": stock,
                }
            )

        return {"items": matched, "total": len(matched)}


# ---------------------------------------------------------------------------
# POST /ozon/import/products
# ---------------------------------------------------------------------------


@router.post("/ozon/import/products", response_model=SyncResultResponse)
async def import_ozon_products(
    payload: OzonProductsImportRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Импорт товаров из Ozon каталога в master_cards."""
    pool = get_db_pool(request)

    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=payload.client_id,
            api_key=payload.api_key,
        )

    async with httpx.AsyncClient(timeout=90.0) as ozon_client:
        visible_products, used_endpoint = await load_ozon_products(
            client_id=client_id,
            api_key=api_key,
            page_size=payload.page_size,
            max_pages=payload.max_pages,
            visibility="VISIBLE",
            http_client=ozon_client,
        )
        for p in visible_products:
            p["_is_archived"] = False

        archived_products: list[dict[str, Any]] = []
        try:
            archived_products, _ = await load_ozon_products(
                client_id=client_id,
                api_key=api_key,
                page_size=payload.page_size,
                max_pages=payload.max_pages,
                visibility="ARCHIVED",
                http_client=ozon_client,
            )
            for p in archived_products:
                p["_is_archived"] = True
        except Exception:
            pass

    products = archived_products + visible_products

    async with pool.acquire() as conn:
        run_id = await create_sync_run(conn, sync_type="ozon_product_import", user_id=admin["id"])

    if not products:
        async with pool.acquire() as conn:
            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed",
                rows_processed=0,
                created_count=0,
                skipped_count=0,
                error_count=0,
                details={"used_endpoint": used_endpoint},
            )
        return {
            "created_count": 0,
            "updated_count": 0,
            "skipped_count": 0,
            "archived_count": 0,
            "total_fetched": 0,
            "used_endpoint": used_endpoint,
        }

    offer_ids = [str(item["offer_id"]) for item in products if item.get("offer_id")]
    product_ids = [str(item["product_id"]) for item in products if item.get("product_id")]
    skus = [str(item["sku"]) for item in products if item.get("sku")]

    async with pool.acquire() as conn:
        async with conn.transaction():
            uid = str(admin["id"])
            existing_rows = await _safe_fetch(
                conn,
                """
                SELECT id, title, description, brand, sku, ozon_product_id, ozon_offer_id, attributes, status
                FROM master_cards
                WHERE user_id = $4
                  AND (($1::text[] IS NOT NULL AND ozon_offer_id = ANY($1::text[]))
                    OR ($2::text[] IS NOT NULL AND ozon_product_id = ANY($2::text[]))
                    OR ($3::text[] IS NOT NULL AND sku = ANY($3::text[])))
                """,
                offer_ids or None,
                product_ids or None,
                skus or None,
                uid,
            )

            by_offer: dict[str, Any] = {}
            by_product: dict[str, Any] = {}
            by_sku: dict[str, Any] = {}
            for row in existing_rows:
                if row["ozon_offer_id"]:
                    by_offer[str(row["ozon_offer_id"])] = row
                if row["ozon_product_id"]:
                    by_product[str(row["ozon_product_id"])] = row
                if row["sku"]:
                    by_sku[str(row["sku"])] = row

            created = 0
            updated = 0
            skipped = 0
            failed = 0
            archived = 0
            error_samples: list[str] = []

            for product in products:
                existing = None
                if product.get("product_id"):
                    existing = by_product.get(str(product["product_id"]))
                if not existing and product.get("offer_id"):
                    existing = by_offer.get(str(product["offer_id"]))
                if not existing and product.get("sku"):
                    existing = by_sku.get(str(product["sku"]))

                source_ref = str(
                    product.get("product_id") or product.get("offer_id") or product.get("sku") or ""
                )
                source_key = _source_key("ozon", source_ref)
                source_data = {
                    "product_id": product.get("product_id"),
                    "offer_id": product.get("offer_id"),
                    "sku": product.get("sku"),
                    "title": product.get("title"),
                    "brand": product.get("brand"),
                    "description": product.get("description"),
                    "images": product.get("images") or [],
                }

                if existing:
                    if not payload.update_existing:
                        skipped += 1
                        continue

                    try:
                        attrs = _parse_jsonb(existing["attributes"])
                        attrs = merge_card_source(
                            attributes=attrs,
                            source_key=source_key,
                            source_kind="marketplace",
                            provider="ozon",
                            external_ref=source_ref or None,
                            data=source_data,
                            raw_payload=product["raw"]
                            if isinstance(product.get("raw"), dict)
                            else None,
                        )
                        if payload.fill_dimensions_from_ozon:
                            attrs = _merge_dimensions(
                                attrs, product.get("dimensions") or {}, overwrite=False
                            )

                        new_title = product.get("title") or ""
                        old_title = existing["title"] or ""

                        def _is_generic(title_value: str) -> bool:
                            return (
                                not title_value
                                or title_value.startswith("Товар ")
                                or title_value.lower().startswith("product ")
                            )

                        if _is_generic(old_title) and not _is_generic(new_title):
                            use_title = new_title
                        else:
                            use_title = old_title or new_title

                        if product.get("_is_archived"):
                            new_status = "archived"
                        elif existing["status"] in ("draft", "archived"):
                            new_status = "active"
                        else:
                            new_status = existing["status"]

                        await _safe_execute(
                            conn,
                            """
                            UPDATE master_cards
                            SET title = $2,
                                description = $3,
                                brand = $4,
                                sku = $5,
                                ozon_product_id = $6,
                                ozon_offer_id = $7,
                                attributes = $8,
                                status = $9,
                                updated_at = NOW()
                            WHERE id = $1
                            """,
                            existing["id"],
                            use_title,
                            existing["description"] or product.get("description"),
                            existing["brand"] or product.get("brand"),
                            existing["sku"] or product.get("sku"),
                            existing["ozon_product_id"] or product.get("product_id"),
                            existing["ozon_offer_id"] or product.get("offer_id"),
                            json.dumps(_to_decimal_for_json(attrs)),
                            new_status,
                        )
                        updated += 1
                        if new_status == "archived":
                            archived += 1
                    except Exception as exc:  # noqa: PERF203
                        failed += 1
                        if len(error_samples) < 20:
                            error_samples.append(
                                f"update {source_ref or product.get('title')}: {exc}"
                            )
                    continue

                try:
                    attrs = merge_card_source(
                        attributes={},
                        source_key=source_key,
                        source_kind="marketplace",
                        provider="ozon",
                        external_ref=source_ref or None,
                        data=source_data,
                        raw_payload=product["raw"]
                        if isinstance(product.get("raw"), dict)
                        else None,
                    )
                    if payload.fill_dimensions_from_ozon:
                        attrs = _merge_dimensions(
                            attrs, product.get("dimensions") or {}, overwrite=False
                        )

                    import_status = "archived" if product.get("_is_archived") else "active"
                    await _safe_execute(
                        conn,
                        """
                        INSERT INTO master_cards (
                            sku, title, description, brand,
                            ozon_product_id, ozon_offer_id,
                            status, attributes, user_id
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $9, $7, $8)
                        """,
                        product.get("sku"),
                        product["title"],
                        product.get("description"),
                        product.get("brand"),
                        product.get("product_id"),
                        product.get("offer_id"),
                        json.dumps(_to_decimal_for_json(attrs)),
                        admin["id"],
                        import_status,
                    )
                    created += 1
                    if import_status == "archived":
                        archived += 1
                except Exception as exc:  # noqa: PERF203
                    failed += 1
                    if len(error_samples) < 20:
                        error_samples.append(f"insert {source_ref or product.get('title')}: {exc}")

            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed" if failed == 0 else "completed_with_errors",
                rows_processed=len(products),
                created_count=created,
                skipped_count=skipped,
                error_count=failed,
                details={
                    "updated_count": updated,
                    "archived_count": archived,
                    "used_endpoint": used_endpoint,
                    "error_samples": error_samples,
                },
            )

            return {
                "created_count": created,
                "updated_count": updated,
                "skipped_count": skipped,
                "failed_count": failed,
                "archived_count": archived,
                "total_fetched": len(products),
                "used_endpoint": used_endpoint,
                "error_samples": error_samples,
            }


# ---------------------------------------------------------------------------
# POST /ozon/sync/finance
# ---------------------------------------------------------------------------


@router.post("/ozon/sync/finance", response_model=SyncResultResponse)
async def sync_ozon_finance(
    payload: OzonSyncRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Синхронизация финансовых транзакций из Ozon API."""
    today = datetime.now(tz=timezone.utc).date()
    from_date = payload.date_from or (today - timedelta(days=90))
    to_date = payload.date_to or today
    if to_date < from_date:
        raise HTTPException(status_code=400, detail="date_to must be >= date_from")

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=payload.client_id,
            api_key=payload.api_key,
        )
        run_id = await create_sync_run(conn, sync_type="ozon_finance", user_id=admin["id"])

    parsed: list[dict[str, Any]] = []
    api_errors: list[str] = []
    pages_fetched = 0

    async with httpx.AsyncClient(timeout=90.0) as ozon_client:
        for chunk_from, chunk_to in _date_windows(from_date, to_date, window_days=30):
            for page in range(1, payload.max_pages + 1):
                request_body = {
                    "filter": {
                        "date": {
                            "from": f"{chunk_from.isoformat()}T00:00:00Z",
                            "to": f"{chunk_to.isoformat()}T23:59:59Z",
                        }
                    },
                    "page": page,
                    "page_size": payload.limit,
                }
                try:
                    api_response = await ozon_post(
                        "/v3/finance/transaction/list",
                        request_body,
                        client_id=client_id,
                        api_key=api_key,
                        http_client=ozon_client,
                    )
                except HTTPException as exc:
                    api_errors.append(f"{chunk_from}..{chunk_to} page {page}: {exc.detail}")
                    break
                pages_fetched += 1
                batch = parse_ozon_finance_transactions(api_response)
                if not batch:
                    break
                parsed.extend(batch)
                if len(batch) < payload.limit:
                    break
            else:
                api_errors.append(
                    f"{chunk_from}..{chunk_to}: reached max_pages={payload.max_pages}, "
                    "results may be truncated",
                )

    created = 0
    skipped = 0
    errors = 0
    error_samples: list[str] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            for item in parsed:
                external_id = str(item.get("external_id") or "")[:120]
                subcategory = str(item.get("subcategory") or "").strip()[:80] or None
                try:
                    result = await _safe_execute(
                        conn,
                        """
                        INSERT INTO finance_transactions (
                            happened_at, kind, category, subcategory,
                            amount_rub, source, external_id, notes, payload, user_id
                        )
                        VALUES ($1, $2, $3, $4, $5, 'ozon_finance', $6, $7, $8, $9)
                        ON CONFLICT (user_id, source, external_id) DO NOTHING
                        """,
                        safe_parse_datetime(str(item.get("happened_at") or "")),
                        item["kind"],
                        item["category"],
                        subcategory,
                        to_money(item["amount_rub"]),
                        external_id,
                        item["notes"] or None,
                        json.dumps(_to_decimal_for_json(item["payload"])),
                        admin["id"],
                    )
                    if result.endswith("0"):
                        skipped += 1
                    else:
                        created += 1
                except Exception as exc:  # noqa: PERF203
                    errors += 1
                    if len(error_samples) < 20:
                        error_samples.append(str(exc))

            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed"
                if (errors == 0 and not api_errors)
                else "completed_with_errors",
                rows_processed=len(parsed),
                created_count=created,
                skipped_count=skipped,
                error_count=errors + len(api_errors),
                details={
                    "request": {
                        "date_from": from_date.isoformat(),
                        "date_to": to_date.isoformat(),
                        "page_size": payload.limit,
                        "max_pages": payload.max_pages,
                    },
                    "source_items": len(parsed),
                    "pages_fetched": pages_fetched,
                    "api_errors": api_errors,
                    "error_samples": error_samples,
                },
            )

    return {
        "run_id": run_id,
        "date_from": from_date.isoformat(),
        "date_to": to_date.isoformat(),
        "rows_processed": len(parsed),
        "created_count": created,
        "skipped_count": skipped,
        "error_count": errors + len(api_errors),
        "pages_fetched": pages_fetched,
        "api_errors": api_errors,
        "error_samples": error_samples,
    }


# ---------------------------------------------------------------------------
# POST /ozon/sync/unit-economics
# ---------------------------------------------------------------------------


@router.post("/ozon/sync/unit-economics", response_model=SyncResultResponse)
async def sync_ozon_unit_economics(
    payload: OzonSyncRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Синхронизация unit-economics данных из Ozon (себестоимость операций)."""
    today = datetime.now(tz=timezone.utc).date()
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=payload.client_id,
            api_key=payload.api_key,
        )

        from_date = payload.date_from
        to_date = payload.date_to or today
        if from_date is None:
            last_row = await _safe_fetchone(
                conn,
                "SELECT MAX(operation_date) AS last_date FROM ozon_sku_economics WHERE user_id = $1",
                admin["id"],
            )
            if last_row and last_row["last_date"]:
                last_date = last_row["last_date"]
                if isinstance(last_date, datetime):
                    last_date = last_date.date()
                from_date = last_date - timedelta(days=14)
            else:
                from_date = today - timedelta(days=90)

        if to_date < from_date:
            raise HTTPException(status_code=400, detail="date_to must be >= date_from")

        run_id = await create_sync_run(conn, sync_type="ozon_unit_economics", user_id=admin["id"])

    all_rows: list[dict[str, Any]] = []
    api_errors: list[str] = []
    pages_fetched = 0
    async with httpx.AsyncClient(timeout=90.0) as ozon_client:
        for chunk_from, chunk_to in _date_windows(from_date, to_date, window_days=30):
            for page in range(1, payload.max_pages + 1):
                request_body = {
                    "filter": {
                        "date": {
                            "from": f"{chunk_from.isoformat()}T00:00:00Z",
                            "to": f"{chunk_to.isoformat()}T23:59:59Z",
                        }
                    },
                    "page": page,
                    "page_size": payload.limit,
                }
                try:
                    api_response = await ozon_post(
                        "/v3/finance/transaction/list",
                        request_body,
                        client_id=client_id,
                        api_key=api_key,
                        http_client=ozon_client,
                    )
                except HTTPException as exc:
                    api_errors.append(f"{chunk_from}..{chunk_to} page {page}: {exc.detail}")
                    break
                pages_fetched += 1

                result = api_response.get("result") if isinstance(api_response, dict) else None
                operations = []
                if isinstance(result, dict):
                    operations = result.get("operations") or []
                if not operations:
                    break

                for op in operations:
                    if not isinstance(op, dict):
                        continue
                    rows = parse_ozon_operation_economics(op, user_id=admin["id"])
                    all_rows.extend(rows)

                if len(operations) < payload.limit:
                    break
            else:
                api_errors.append(
                    f"{chunk_from}..{chunk_to}: reached max_pages={payload.max_pages}, "
                    "results may be truncated",
                )

    created = 0
    updated = 0
    errors_count = 0
    error_samples: list[str] = []
    cogs_updated = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            for row in all_rows:
                try:
                    upsert_row = await _safe_fetchone(
                        conn,
                        """
                        INSERT INTO ozon_sku_economics (
                            user_id, operation_id, operation_date, operation_type,
                            posting_number, delivery_schema, sku, product_name,
                            revenue, sale_commission, total_amount,
                            last_mile, pipeline, fulfillment, dropoff,
                            acquiring, return_logistics, return_processing,
                            marketing, installment, other_services,
                            services_raw, quantity, finance_type
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8,
                            $9, $10, $11,
                            $12, $13, $14, $15,
                            $16, $17, $18,
                            $19, $20, $21,
                            $22, $23, $24
                        )
                        ON CONFLICT (user_id, operation_id, sku) DO UPDATE SET
                            operation_date = EXCLUDED.operation_date,
                            operation_type = EXCLUDED.operation_type,
                            posting_number = EXCLUDED.posting_number,
                            delivery_schema = EXCLUDED.delivery_schema,
                            product_name = EXCLUDED.product_name,
                            revenue = EXCLUDED.revenue,
                            sale_commission = EXCLUDED.sale_commission,
                            total_amount = EXCLUDED.total_amount,
                            last_mile = EXCLUDED.last_mile,
                            pipeline = EXCLUDED.pipeline,
                            fulfillment = EXCLUDED.fulfillment,
                            dropoff = EXCLUDED.dropoff,
                            acquiring = EXCLUDED.acquiring,
                            return_logistics = EXCLUDED.return_logistics,
                            return_processing = EXCLUDED.return_processing,
                            marketing = EXCLUDED.marketing,
                            installment = EXCLUDED.installment,
                            other_services = EXCLUDED.other_services,
                            services_raw = EXCLUDED.services_raw,
                            quantity = EXCLUDED.quantity,
                            finance_type = EXCLUDED.finance_type
                        RETURNING (xmax = 0) AS inserted
                        """,
                        row["user_id"],
                        row["operation_id"],
                        safe_parse_datetime(str(row["operation_date"])),
                        row["operation_type"],
                        row["posting_number"],
                        row["delivery_schema"],
                        row["sku"],
                        row["product_name"],
                        to_money(row["revenue"]),
                        to_money(row["sale_commission"]),
                        to_money(row["total_amount"]),
                        to_money(row["last_mile"]),
                        to_money(row["pipeline"]),
                        to_money(row["fulfillment"]),
                        to_money(row["dropoff"]),
                        to_money(row["acquiring"]),
                        to_money(row["return_logistics"]),
                        to_money(row["return_processing"]),
                        to_money(row["marketing"]),
                        to_money(row["installment"]),
                        to_money(row["other_services"]),
                        json.dumps(row["services_raw"]),
                        row.get("quantity", 1),
                        row.get("finance_type", ""),
                    )
                    if upsert_row and bool(upsert_row["inserted"]):
                        created += 1
                    else:
                        updated += 1
                except Exception as exc:  # noqa: PERF203
                    errors_count += 1
                    if len(error_samples) < 20:
                        error_samples.append(str(exc))

            # Enrich COGS via virtual FIFO
            try:
                lot_rows = await _safe_fetch(
                    conn,
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
                    str(admin["id"]),
                )
                sale_rows = await _safe_fetch(
                    conn,
                    """
                SELECT id, sku, quantity, operation_date
                FROM ozon_sku_economics
                WHERE user_id = $1 AND sku != 0
                  AND (finance_type = 'orders' OR (finance_type = '' AND revenue > 0))
                ORDER BY sku, operation_date ASC
                """,
                    admin["id"],
                )
                lots_by_sku: dict[int, list[dict[str, Any]]] = {}
                for lr in lot_rows:
                    sid = int(lr["sku_id"])
                    lots_by_sku.setdefault(sid, []).append(dict(lr))
                sales_by_sku: dict[int, list[dict[str, Any]]] = {}
                for sr in sale_rows:
                    sid = int(sr["sku"])
                    sales_by_sku.setdefault(sid, []).append(dict(sr))

                update_pairs: list[tuple[int, Decimal]] = []
                epsilon = Decimal("0.000001")
                for sku_id, sales in sales_by_sku.items():
                    lots = lots_by_sku.get(sku_id, [])
                    lot_idx = 0
                    lot_remaining = Decimal(str(lots[0]["initial_qty"])) if lots else Decimal("0")

                    for sale in sales:
                        qty_needed = to_qty(sale.get("quantity") or 1)
                        total_cost = Decimal("0")

                        while qty_needed > epsilon and lot_idx < len(lots):
                            take = min(qty_needed, lot_remaining)
                            if take <= epsilon:
                                lot_idx += 1
                                if lot_idx < len(lots):
                                    lot_remaining = Decimal(str(lots[lot_idx]["initial_qty"]))
                                continue
                            total_cost += take * Decimal(str(lots[lot_idx]["unit_cost_rub"]))
                            lot_remaining -= take
                            qty_needed -= take
                            if lot_remaining <= epsilon:
                                lot_idx += 1
                                if lot_idx < len(lots):
                                    lot_remaining = Decimal(str(lots[lot_idx]["initial_qty"]))

                        if total_cost > 0:
                            update_pairs.append((int(sale["id"]), total_cost))

                for sale_id, cogs_val in update_pairs:
                    await _safe_execute(
                        conn,
                        "UPDATE ozon_sku_economics SET cogs = $1 WHERE id = $2",
                        to_money(cogs_val),
                        sale_id,
                    )
                    cogs_updated += 1
            except Exception as fifo_exc:
                logger.warning("FIFO enrichment failed: %s", fifo_exc)

            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed"
                if (errors_count == 0 and not api_errors)
                else "completed_with_errors",
                rows_processed=len(all_rows),
                created_count=created,
                skipped_count=updated,
                error_count=errors_count + len(api_errors),
                details={
                    "request": {
                        "date_from": from_date.isoformat(),
                        "date_to": to_date.isoformat(),
                        "page_size": payload.limit,
                        "max_pages": payload.max_pages,
                    },
                    "source_operations": len(all_rows),
                    "pages_fetched": pages_fetched,
                    "cogs_enriched": cogs_updated,
                    "api_errors": api_errors,
                    "error_samples": error_samples,
                },
            )

    return {
        "run_id": run_id,
        "date_from": from_date.isoformat(),
        "date_to": to_date.isoformat(),
        "rows_processed": len(all_rows),
        "created_count": created,
        "updated_count": updated,
        "error_count": errors_count + len(api_errors),
        "cogs_enriched": cogs_updated,
        "pages_fetched": pages_fetched,
        "api_errors": api_errors,
        "error_samples": error_samples,
    }


# ---------------------------------------------------------------------------
# POST /ozon/sync/supplies
# ---------------------------------------------------------------------------


@router.post("/ozon/sync/supplies", response_model=SyncResultResponse)
async def sync_ozon_supplies(
    payload: OzonSupplySyncRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Sync supply orders from Ozon Seller API."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=payload.client_id,
            api_key=payload.api_key,
        )
        run_id = await create_sync_run(conn, sync_type="ozon_supplies", user_id=admin["id"])

        uid = str(admin["id"])
        cards = await _safe_fetch(
            conn,
            """
            SELECT mc.id,
                   (SELECT v->'data'->>'offer_id'
                    FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                    WHERE k LIKE 'ozon:%%'
                      AND v->'data'->>'offer_id' IS NOT NULL
                    LIMIT 1) AS ozon_offer_id,
                   (SELECT v->'data'->>'sku'
                    FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                    WHERE k LIKE 'ozon:%%'
                      AND v->'data'->>'sku' IS NOT NULL
                    LIMIT 1) AS ozon_data_sku
            FROM master_cards mc WHERE mc.user_id = $1 AND mc.status != 'archived'
            """,
            uid,
        )
        offer_lookup: dict[str, str] = {}
        sku_lookup: dict[str, str] = {}
        for c in cards:
            cid = str(c["id"])
            if c["ozon_offer_id"]:
                offer_lookup[str(c["ozon_offer_id"])] = cid
            if c["ozon_data_sku"]:
                sku_lookup[str(c["ozon_data_sku"])] = cid

        api_errors: list[str] = []

        all_order_ids: list[int] = []
        try:
            list_resp = await ozon_post(
                "/v3/supply-order/list",
                {
                    "filter": {"states": list(range(1, 12))},
                    "limit": 100,
                    "sort_by": 1,
                },
                client_id=client_id,
                api_key=api_key,
            )
            all_order_ids = list_resp.get("order_ids") or []
        except HTTPException as exc:
            api_errors.append(f"v3/supply-order/list: {exc.detail}")

        created = 0
        updated = 0
        errors = 0
        error_samples: list[str] = []

        for batch_start in range(0, len(all_order_ids), 50):
            batch_ids = all_order_ids[batch_start : batch_start + 50]
            try:
                get_resp = await ozon_post(
                    "/v3/supply-order/get",
                    {"order_ids": batch_ids},
                    client_id=client_id,
                    api_key=api_key,
                )
            except HTTPException as exc:
                api_errors.append(f"v3/supply-order/get: {exc.detail}")
                continue

            for order in get_resp.get("orders") or []:
                try:
                    order_id = int(order.get("order_id", 0))
                    order_number = order.get("order_number", "")
                    state = order.get("state", "")
                    raw_date = order.get("created_date") or ""
                    creation_date = (
                        datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
                        if raw_date
                        else None
                    )
                    supplies = order.get("supplies") or []

                    drop_off = order.get("drop_off_warehouse") or {}
                    wh_name = drop_off.get("name", "")
                    wh_id = drop_off.get("warehouse_id")

                    row = await _safe_fetchone(
                        conn,
                        """
                        INSERT INTO ozon_supplies (
                            user_id, ozon_supply_order_id, supply_number, status,
                            warehouse_name, warehouse_id, created_ozon_at, updated_ozon_at,
                            total_items_planned, total_items_accepted, raw_payload, synced_at
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,NOW())
                        ON CONFLICT (user_id, ozon_supply_order_id) DO UPDATE SET
                            status = EXCLUDED.status,
                            supply_number = EXCLUDED.supply_number,
                            warehouse_name = EXCLUDED.warehouse_name,
                            raw_payload = EXCLUDED.raw_payload,
                            synced_at = NOW(),
                            updated_at = NOW()
                        RETURNING id, (xmax = 0) AS is_insert
                        """,
                        str(admin["id"]),
                        order_id,
                        order_number,
                        state,
                        wh_name or None,
                        wh_id,
                        creation_date,
                        0,
                        0,
                        json.dumps(order),
                    )
                    if not row:
                        continue
                    supply_db_id = str(row["id"])
                    if row["is_insert"]:
                        created += 1
                    else:
                        updated += 1

                    bundle_ids = [s["bundle_id"] for s in supplies if s.get("bundle_id")]
                    if not bundle_ids:
                        continue

                    all_items: list[dict[str, Any]] = []
                    for bid in bundle_ids:
                        last_id_str = ""
                        for _ in range(10):
                            try:
                                bundle_resp = await ozon_post(
                                    "/v1/supply-order/bundle",
                                    {
                                        "bundle_ids": [bid],
                                        "limit": 100,
                                        "last_id": last_id_str,
                                    },
                                    client_id=client_id,
                                    api_key=api_key,
                                )
                            except HTTPException as exc:
                                api_errors.append(f"bundle {bid}: {exc.detail}")
                                break
                            page_items = bundle_resp.get("items") or []
                            for pi in page_items:
                                all_items.append(
                                    {
                                        "sku": pi.get("sku"),
                                        "offer_id": pi.get("offer_id"),
                                        "product_id": pi.get("product_id"),
                                        "name": pi.get("name", ""),
                                        "quantity": pi.get("quantity", 0),
                                    }
                                )
                            if not bundle_resp.get("has_next"):
                                break
                            last_id_str = bundle_resp.get("last_id", "")

                    # Preserve manually entered acceptance data before re-insert
                    saved_acceptance = await _safe_fetch(
                        conn,
                        """
                        SELECT ozon_offer_id, quantity_planned,
                               quantity_accepted, quantity_rejected, loss_written_off
                        FROM ozon_supply_items
                        WHERE ozon_supply_id = $1
                          AND (quantity_accepted > 0 OR quantity_rejected > 0 OR loss_written_off)
                        """,
                        supply_db_id,
                    )

                    await _safe_execute(
                        conn,
                        "DELETE FROM ozon_supply_items WHERE ozon_supply_id = $1",
                        supply_db_id,
                    )
                    total_planned = 0
                    for item in all_items:
                        item_offer = str(item.get("offer_id") or "")
                        sku_str = str(item.get("sku") or "")
                        card_id = offer_lookup.get(item_offer) or sku_lookup.get(sku_str)
                        qty = int(item.get("quantity") or 0)
                        total_planned += qty
                        await _safe_execute(
                            conn,
                            """
                            INSERT INTO ozon_supply_items (
                                ozon_supply_id, master_card_id, ozon_offer_id, ozon_sku,
                                product_name, quantity_planned, quantity_accepted, quantity_rejected
                            ) VALUES ($1,$2,$3,$4,$5,$6,0,0)
                            """,
                            supply_db_id,
                            card_id,
                            item_offer or str(item.get("product_id") or ""),
                            int(sku_str) if sku_str else None,
                            item["name"],
                            qty,
                        )

                    # Restore saved acceptance data by matching (offer_id, qty)
                    for sa_row in saved_acceptance:
                        await _safe_execute(
                            conn,
                            """
                            UPDATE ozon_supply_items
                            SET quantity_accepted = $1,
                                quantity_rejected = $2,
                                loss_written_off = $3
                            WHERE id = (
                                SELECT id FROM ozon_supply_items
                                WHERE ozon_supply_id = $4
                                  AND ozon_offer_id = $5
                                  AND quantity_planned = $6
                                  AND quantity_accepted = 0
                                LIMIT 1
                            )
                            """,
                            int(sa_row["quantity_accepted"]),
                            int(sa_row["quantity_rejected"]),
                            bool(sa_row["loss_written_off"]),
                            supply_db_id,
                            sa_row["ozon_offer_id"],
                            int(sa_row["quantity_planned"]),
                        )

                    if total_planned > 0:
                        await _safe_execute(
                            conn,
                            "UPDATE ozon_supplies SET total_items_planned = $1 WHERE id = $2",
                            total_planned,
                            supply_db_id,
                        )

                    # Warehouse deduction for shipped supplies
                    shipped_states = {
                        "ACCEPTED_AT_SUPPLY_WAREHOUSE",
                        "IN_TRANSIT",
                        "ACCEPTANCE_AT_STORAGE_WAREHOUSE",
                        "REPORTS_CONFIRMATION_AWAITING",
                        "REPORT_REJECTED",
                        "COMPLETED",
                    }
                    cancelled_states = {"CANCELLED", "REJECTED_AT_SUPPLY_WAREHOUSE"}

                    prev_deducted = await _safe_fetchone(
                        conn,
                        "SELECT warehouse_deducted FROM ozon_supplies WHERE id = $1",
                        supply_db_id,
                    )
                    was_deducted = bool(prev_deducted and prev_deducted["warehouse_deducted"])

                    if state in shipped_states and not was_deducted:
                        for item in all_items:
                            item_offer = str(item.get("offer_id") or "")
                            sku_str = str(item.get("sku") or "")
                            card_id = offer_lookup.get(item_offer) or sku_lookup.get(sku_str)
                            if not card_id:
                                continue
                            qty = Decimal(str(int(item.get("quantity") or 0)))
                            if qty > 0:
                                await stock_repo.update_warehouse_qty(
                                    conn, master_card_id=card_id, delta=-qty
                                )
                                await stock_repo.create_stock_movement(
                                    conn,
                                    user_id=uid,
                                    master_card_id=card_id,
                                    movement_type="supply_to_ozon",
                                    quantity=-qty,
                                    reference_type="ozon_supply",
                                    reference_id=supply_db_id,
                                )
                        await stock_repo.set_supply_warehouse_deducted(
                            conn, supply_id=supply_db_id, deducted=True
                        )
                    elif state in cancelled_states and was_deducted:
                        for item in all_items:
                            item_offer = str(item.get("offer_id") or "")
                            sku_str = str(item.get("sku") or "")
                            card_id = offer_lookup.get(item_offer) or sku_lookup.get(sku_str)
                            if not card_id:
                                continue
                            qty = Decimal(str(int(item.get("quantity") or 0)))
                            if qty > 0:
                                await stock_repo.update_warehouse_qty(
                                    conn, master_card_id=card_id, delta=qty
                                )
                                await stock_repo.create_stock_movement(
                                    conn,
                                    user_id=uid,
                                    master_card_id=card_id,
                                    movement_type="supply_cancelled",
                                    quantity=qty,
                                    reference_type="ozon_supply",
                                    reference_id=supply_db_id,
                                )
                        await stock_repo.set_supply_warehouse_deducted(
                            conn, supply_id=supply_db_id, deducted=False
                        )

                except Exception as exc:
                    errors += 1
                    if len(error_samples) < 20:
                        error_samples.append(f"supply #{order.get('order_id')}: {exc}")

        await finish_sync_run(
            conn,
            run_id=run_id,
            status_text="completed" if not errors else "completed_with_errors",
            rows_processed=len(all_order_ids),
            created_count=created,
            skipped_count=updated,
            error_count=errors,
            details={
                "api_errors": api_errors[:20],
                "error_samples": error_samples,
            },
        )

        return {
            "created_count": created,
            "updated_count": updated,
            "error_count": errors,
            "total_supplies": len(all_order_ids),
            "api_errors": api_errors[:5],
            "error_samples": error_samples[:5],
        }


# ---------------------------------------------------------------------------
# POST /ozon/sync/warehouse-stock
# ---------------------------------------------------------------------------


@router.post("/ozon/sync/warehouse-stock", response_model=SyncResultResponse)
async def sync_ozon_warehouse_stock(
    payload: OzonWarehouseStockSyncRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Sync Ozon warehouse stock levels (FBO + FBS) into snapshots."""
    pool = get_db_pool(request)
    snapshot_at = datetime.now(tz=timezone.utc)

    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=payload.client_id,
            api_key=payload.api_key,
        )
        run_id = await create_sync_run(conn, sync_type="ozon_warehouse_stock", user_id=admin["id"])

        uid = str(admin["id"])
        cards = await _safe_fetch(
            conn,
            """
            SELECT mc.id,
                   (SELECT v->'data'->>'offer_id'
                    FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                    WHERE k LIKE 'ozon:%%'
                      AND v->'data'->>'offer_id' IS NOT NULL
                    LIMIT 1) AS ozon_offer_id,
                   (SELECT v->>'external_ref'
                    FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                    WHERE k LIKE 'ozon:%%'
                      AND v->>'external_ref' IS NOT NULL
                    LIMIT 1) AS ozon_product_id
            FROM master_cards mc WHERE mc.user_id = $1 AND mc.status != 'archived'
            """,
            uid,
        )
        offer_to_card: dict[str, str] = {}
        product_to_card: dict[str, str] = {}
        for c in cards:
            cid = str(c["id"])
            if c["ozon_offer_id"]:
                offer_to_card[str(c["ozon_offer_id"])] = cid
            if c["ozon_product_id"]:
                product_to_card[str(c["ozon_product_id"])] = cid

        stock_rows: list[dict[str, Any]] = []
        api_errors: list[str] = []

        async with httpx.AsyncClient(timeout=90.0) as ozon_client:
            cursor = ""
            for _ in range(20):
                body: dict[str, Any] = {
                    "filter": {"visibility": "ALL"},
                    "cursor": cursor,
                    "limit": 1000,
                }
                try:
                    data = await ozon_post(
                        "/v4/product/info/stocks",
                        body,
                        client_id=client_id,
                        api_key=api_key,
                        http_client=ozon_client,
                    )
                except HTTPException as exc:
                    api_errors.append(f"/v4/product/info/stocks: {exc.detail}")
                    break
                items = data.get("items", [])
                if not items:
                    break
                for si in items:
                    oid = str(si.get("offer_id", ""))
                    pid = str(si.get("product_id", ""))
                    for s in si.get("stocks") or []:
                        wh_type = str(s.get("type", ""))
                        stock_type = "fbo" if wh_type == "fbo" else "fbs"
                        present = int(s.get("present", 0))
                        reserved = int(s.get("reserved", 0))
                        if present <= 0 and reserved <= 0:
                            continue
                        stock_rows.append(
                            {
                                "offer_id": oid,
                                "product_id": pid,
                                "warehouse_name": wh_type.upper() if wh_type == "fbo" else wh_type,
                                "stock_type": stock_type,
                                "present": present,
                                "reserved": reserved,
                                "free_to_sell": max(0, present - reserved),
                            }
                        )
                cursor = data.get("cursor", "")
                if not cursor or len(items) < 1000:
                    break

        created = 0
        errors = 0
        for sr in stock_rows:
            card_id = offer_to_card.get(sr["offer_id"]) or product_to_card.get(sr["product_id"])
            try:
                await _safe_execute(
                    conn,
                    """
                    INSERT INTO ozon_warehouse_stock (
                        user_id, master_card_id, ozon_offer_id, ozon_product_id,
                        warehouse_name, stock_type, present, reserved, free_to_sell,
                        snapshot_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    """,
                    str(admin["id"]),
                    card_id,
                    sr["offer_id"] or None,
                    sr["product_id"] or None,
                    sr["warehouse_name"],
                    sr["stock_type"],
                    sr["present"],
                    sr["reserved"],
                    sr["free_to_sell"],
                    snapshot_at,
                )
                created += 1
            except Exception:
                errors += 1

        await finish_sync_run(
            conn,
            run_id=run_id,
            status_text="completed" if not errors else "completed_with_errors",
            rows_processed=len(stock_rows),
            created_count=created,
            skipped_count=0,
            error_count=errors,
            details={"api_errors": api_errors[:20], "snapshot_at": snapshot_at.isoformat()},
        )

        return {
            "created_count": created,
            "error_count": errors,
            "total_rows": len(stock_rows),
            "snapshot_at": snapshot_at.isoformat(),
            "api_errors": api_errors[:5],
        }


# ---------------------------------------------------------------------------
# POST /ozon/sync/returns
# ---------------------------------------------------------------------------


@router.post("/ozon/sync/returns", response_model=SyncResultResponse)
async def sync_ozon_returns(
    payload: OzonSyncRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Sync customer returns from Ozon into ozon_returns table."""
    today = datetime.now(tz=timezone.utc).date()
    from_date = payload.date_from or (today - timedelta(days=90))
    to_date = payload.date_to or today

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=payload.client_id,
            api_key=payload.api_key,
        )
        run_id = await create_sync_run(conn, sync_type="ozon_returns", user_id=admin["id"])

        uid = str(admin["id"])
        cards = await _safe_fetch(
            conn,
            """
            SELECT mc.id, mc.ozon_offer_id
            FROM master_cards mc
            WHERE mc.user_id = $1 AND mc.status != 'archived'
              AND mc.ozon_offer_id IS NOT NULL
            """,
            uid,
        )
        offer_to_card: dict[str, str] = {}
        for c in cards:
            if c["ozon_offer_id"]:
                offer_to_card[str(c["ozon_offer_id"])] = str(c["id"])

    all_returns: list[dict[str, Any]] = []
    api_errors: list[str] = []
    last_id = 0

    async with httpx.AsyncClient(timeout=90.0) as ozon_client:
        for _ in range(100):
            body: dict[str, Any] = {
                "filter": {
                    "logistic_return_date": {
                        "time_from": f"{from_date.isoformat()}T00:00:00Z",
                        "time_to": f"{to_date.isoformat()}T23:59:59Z",
                    },
                },
                "last_id": last_id,
                "limit": 500,
            }
            try:
                resp = await ozon_post(
                    "/v1/returns/list",
                    body,
                    client_id=client_id,
                    api_key=api_key,
                    http_client=ozon_client,
                )
            except HTTPException as exc:
                api_errors.append(f"/v1/returns/list: {exc.detail}")
                break

            returns = resp.get("returns") or []
            all_returns.extend(returns)

            if not resp.get("has_next"):
                break
            last_id = resp.get("last_id", 0)
            if not last_id:
                break

    created = 0
    updated_count = 0
    errors_count = 0
    error_samples: list[str] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            for ret in all_returns:
                try:
                    return_id = int(ret.get("id") or 0)
                    if not return_id:
                        continue

                    # Product info is nested under "product"
                    product = ret.get("product") or {}
                    offer_id = str(product.get("offer_id") or "")
                    sku = int(product.get("sku") or 0) or None
                    card_id = offer_to_card.get(offer_id)

                    # Logistic dates nested under "logistic"
                    logistic = ret.get("logistic") or {}
                    logistic_date_raw = logistic.get("return_date") or ""
                    logistic_date = (
                        safe_parse_datetime(logistic_date_raw) if logistic_date_raw else None
                    )

                    # Visual status nested under "visual.status"
                    visual = ret.get("visual") or {}
                    visual_status = (visual.get("status") or {}).get("sys_name") or ""

                    # Additional info
                    additional = ret.get("additional_info") or {}

                    # Return type: "Cancellation" or "CustomerReturn"
                    return_type = ret.get("type") or ""

                    row = await stock_repo.upsert_ozon_return(
                        conn,
                        user_id=uid,
                        ozon_return_id=return_id,
                        posting_number=str(ret.get("order_number") or ""),
                        ozon_offer_id=offer_id or None,
                        ozon_sku=sku,
                        product_name=product.get("name"),
                        quantity=int(product.get("quantity") or 1),
                        status=visual_status,
                        return_reason=ret.get("return_reason_name"),
                        is_opened=bool(additional.get("is_opened")),
                        logistic_return_date=logistic_date,
                        master_card_id=card_id,
                        return_type=return_type,
                    )
                    if row and row.get("is_insert"):
                        created += 1
                    else:
                        updated_count += 1
                except Exception as exc:  # noqa: PERF203
                    errors_count += 1
                    if len(error_samples) < 20:
                        error_samples.append(str(exc))

            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed"
                if (errors_count == 0 and not api_errors)
                else "completed_with_errors",
                rows_processed=len(all_returns),
                created_count=created,
                skipped_count=updated_count,
                error_count=errors_count + len(api_errors),
                details={
                    "api_errors": api_errors[:20],
                    "error_samples": error_samples,
                    "date_from": from_date.isoformat(),
                    "date_to": to_date.isoformat(),
                },
            )

    return {
        "run_id": run_id,
        "total_returns": len(all_returns),
        "created_count": created,
        "updated_count": updated_count,
        "error_count": errors_count + len(api_errors),
        "api_errors": api_errors[:5],
        "error_samples": error_samples[:5],
    }


# ---------------------------------------------------------------------------
# POST /ozon/sync/cluster-stock
# ---------------------------------------------------------------------------


@router.post("/ozon/sync/cluster-stock", response_model=SyncResultResponse)
async def sync_ozon_cluster_stock(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Sync cluster-level stock + Ozon analytics into ozon_cluster_stock.

    Calls /v1/analytics/stocks with batched SKU lists (max 100 per call).
    Replaces the broken FBO sync that was missing the required `skus` param.
    """
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=None,
            api_key=None,
        )
        run_id = await create_sync_run(conn, sync_type="ozon_cluster_stock", user_id=admin["id"])

        uid = str(admin["id"])

        # Load all integer SKUs from master_cards attributes→sources→ozon:*→data→sku
        cards = await _safe_fetch(
            conn,
            """
            SELECT mc.id,
                   (SELECT (v->'data'->>'sku')::bigint
                    FROM jsonb_each(mc.attributes->'sources') AS t(k, v)
                    WHERE k LIKE 'ozon:%%'
                      AND v->'data'->>'sku' IS NOT NULL
                      AND v->'data'->>'sku' ~ '^[0-9]+$'
                    LIMIT 1) AS ozon_sku
            FROM master_cards mc
            WHERE mc.user_id = $1 AND mc.status != 'archived'
            """,
            uid,
        )
        sku_to_card: dict[int, str] = {}
        all_skus: list[int] = []
        for c in cards:
            if c["ozon_sku"]:
                sku_val = int(c["ozon_sku"])
                sku_to_card[sku_val] = str(c["id"])
                all_skus.append(sku_val)

    if not all_skus:
        async with pool.acquire() as conn:
            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed",
                rows_processed=0,
                created_count=0,
                skipped_count=0,
                error_count=0,
                details={"message": "No SKUs found in master_cards"},
            )
        return {
            "run_id": run_id,
            "created_count": 0,
            "updated_count": 0,
            "total_skus": 0,
            "message": "Нет привязанных SKU. Сначала импортируйте товары из Ozon.",
        }

    # Batch SKUs by 100 (API limit) and call /v1/analytics/stocks
    all_parsed: list[dict[str, Any]] = []
    api_errors: list[str] = []

    async with httpx.AsyncClient(timeout=90.0) as ozon_client:
        for batch_start in range(0, len(all_skus), 100):
            batch_skus = all_skus[batch_start : batch_start + 100]
            try:
                resp = await ozon_post(
                    "/v1/analytics/stocks",
                    {"skus": batch_skus},
                    client_id=client_id,
                    api_key=api_key,
                    http_client=ozon_client,
                )
            except HTTPException as exc:
                api_errors.append(f"/v1/analytics/stocks batch {batch_start}: {exc.detail}")
                continue

            batch_parsed = parse_ozon_cluster_stock(resp)
            all_parsed.extend(batch_parsed)

    # Upsert into ozon_cluster_stock
    created = 0
    updated = 0
    errors = 0
    error_samples: list[str] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Clear old data for this user before inserting fresh snapshot
            await _safe_execute(
                conn,
                "DELETE FROM ozon_cluster_stock WHERE user_id = $1",
                uid,
            )

            for row in all_parsed:
                master_card_id = sku_to_card.get(row["ozon_sku"])
                try:
                    await _safe_execute(
                        conn,
                        """
                        INSERT INTO ozon_cluster_stock (
                            user_id, master_card_id, ozon_sku, offer_id,
                            cluster_id, cluster_name, warehouse_id, warehouse_name,
                            available, in_transit, reserved,
                            ads_cluster, idc_cluster, turnover_cluster, days_no_sales_cluster,
                            ads_global, idc_global, turnover_global, item_tags,
                            synced_at
                        ) VALUES (
                            $1, $2, $3, $4,
                            $5, $6, $7, $8,
                            $9, $10, $11,
                            $12, $13, $14, $15,
                            $16, $17, $18, $19,
                            NOW()
                        )
                        """,
                        uid,
                        master_card_id,
                        row["ozon_sku"],
                        row["offer_id"] or None,
                        row["cluster_id"],
                        row["cluster_name"] or None,
                        row["warehouse_id"],
                        row["warehouse_name"] or None,
                        row["available"],
                        row["in_transit"],
                        row["reserved"],
                        row["ads_cluster"],
                        row["idc_cluster"],
                        row["turnover_cluster"],
                        row["days_no_sales_cluster"],
                        row["ads_global"],
                        row["idc_global"],
                        row["turnover_global"],
                        row["item_tags"] or None,
                    )
                    created += 1
                except Exception as exc:  # noqa: PERF203
                    errors += 1
                    if len(error_samples) < 20:
                        error_samples.append(str(exc))

            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed" if not (errors or api_errors) else "completed_with_errors",
                rows_processed=len(all_parsed),
                created_count=created,
                skipped_count=updated,
                error_count=errors + len(api_errors),
                details={
                    "total_skus": len(all_skus),
                    "total_rows_parsed": len(all_parsed),
                    "api_errors": api_errors[:20],
                    "error_samples": error_samples,
                },
            )

    return {
        "run_id": run_id,
        "total_skus": len(all_skus),
        "created_count": created,
        "updated_count": updated,
        "error_count": errors + len(api_errors),
        "total_rows_parsed": len(all_parsed),
        "api_errors": api_errors[:5],
        "error_samples": error_samples[:5],
    }


# ---------------------------------------------------------------------------
# POST /ozon/sync/fbo-postings — helpers
# ---------------------------------------------------------------------------


async def _run_fifo_for_existing_item(
    conn,
    *,
    order_id: str,
    card_id: str,
    offer_id: str,
    quantity: int,
    unit_price: Decimal,
) -> None:
    """Run FIFO allocation for an existing sale item (e.g. un-cancelled posting)."""
    from proxy.src.services.admin.fifo_service import (
        FifoLot,
        allocate_fifo_partial,
        calculate_sale_metrics,
        to_money,
        to_qty,
    )

    # Find the sale item
    item_row = await conn.fetchrow(
        """
        SELECT id, quantity FROM sales_order_items
        WHERE sales_order_id = $1::uuid AND source_offer_id = $2
        """,
        order_id,
        offer_id,
    )
    if not item_row:
        return

    sale_item_id = str(item_row["id"])
    qty = to_qty(quantity)

    # Get FIFO lots for card
    lot_rows = await conn.fetch(
        """
        SELECT id, remaining_qty, unit_cost_rub, received_at
        FROM inventory_lots
        WHERE master_card_id = $1::uuid AND remaining_qty > 0
        ORDER BY received_at ASC, created_at ASC
        FOR UPDATE
        """,
        card_id,
    )
    lots = [
        FifoLot(
            lot_id=str(r["id"]),
            remaining_qty=to_qty(r["remaining_qty"]),
            unit_cost_rub=to_money(r["unit_cost_rub"]),
            received_at=r["received_at"],
        )
        for r in lot_rows
    ]

    allocations = allocate_fifo_partial(lots, qty)
    metrics = calculate_sale_metrics(
        quantity=quantity,
        unit_sale_price_rub=unit_price,
        allocations=allocations,
    )

    # Deduct lots + create fifo_allocations
    for alloc in allocations:
        await conn.execute(
            "UPDATE inventory_lots SET remaining_qty = remaining_qty - $1 WHERE id = $2::uuid",
            alloc.quantity,
            alloc.lot_id,
        )
        await conn.execute(
            """
            INSERT INTO fifo_allocations
                (sales_order_item_id, inventory_lot_id, quantity, unit_cost_rub, total_cost_rub)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5)
            """,
            sale_item_id,
            alloc.lot_id,
            alloc.quantity,
            alloc.unit_cost_rub,
            alloc.total_cost_rub,
        )

    # Update sale item with COGS + price
    await conn.execute(
        """
        UPDATE sales_order_items
        SET cogs_rub = $1, gross_profit_rub = $2,
            unit_sale_price_rub = CASE WHEN unit_sale_price_rub = 0 THEN $3 ELSE unit_sale_price_rub END
        WHERE id = $4::uuid
        """,
        metrics["cogs_rub"],
        metrics["gross_profit_rub"],
        to_money(unit_price),
        sale_item_id,
    )


# ---------------------------------------------------------------------------
# POST /ozon/sync/fbo-postings
# ---------------------------------------------------------------------------


@router.post("/ozon/sync/fbo-postings", response_model=SyncResultResponse)
async def sync_fbo_postings(
    payload: OzonSyncRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Sync FBO postings into sales_orders with real statuses + FIFO allocation."""
    today = datetime.now(tz=timezone.utc).date()
    from_date = payload.date_from or date(2020, 1, 1)
    to_date = payload.date_to or today
    if to_date < from_date:
        raise HTTPException(status_code=400, detail="date_to must be >= date_from")

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=str(admin["id"]),
            client_id=payload.client_id,
            api_key=payload.api_key,
        )
        run_id = await create_sync_run(conn, sync_type="fbo_postings", user_id=admin["id"])

    # Fetch FBO postings from Ozon API
    raw_postings: list[dict[str, Any]] = []
    api_errors: list[str] = []
    async with httpx.AsyncClient(timeout=90.0) as ozon_client:
        for chunk_from, chunk_to in _date_windows(from_date, to_date, window_days=7):
            offset = 0
            for _ in range(payload.max_pages):
                body = {
                    "dir": "ASC",
                    "filter": {
                        "since": f"{chunk_from.isoformat()}T00:00:00Z",
                        "to": f"{chunk_to.isoformat()}T23:59:59Z",
                    },
                    "limit": payload.limit,
                    "offset": offset,
                }
                try:
                    resp = await ozon_post(
                        "/v3/posting/fbo/list",
                        body,
                        client_id=client_id,
                        api_key=api_key,
                        http_client=ozon_client,
                    )
                except HTTPException as exc:
                    api_errors.append(
                        f"/v3/posting/fbo/list ({chunk_from}..{chunk_to}, offset {offset}): "
                        f"{exc.detail}"
                    )
                    break

                result = resp.get("result") if isinstance(resp, dict) else None
                postings = (
                    result if isinstance(result, list) else (result or resp).get("postings", [])
                )
                if not postings:
                    break
                raw_postings.extend(postings)
                if len(postings) < payload.limit:
                    break
                offset += payload.limit

    # Deduplicate by posting_number
    unique_postings: dict[str, dict[str, Any]] = {}
    for p in raw_postings:
        pn = p.get("posting_number")
        if pn:
            unique_postings[pn] = p
    raw_postings = list(unique_postings.values())

    # Build card map: offer_id/sku → master_card_id
    all_offer_ids: set[str] = set()
    for p in raw_postings:
        for product in p.get("products") or []:
            oid = product.get("offer_id")
            if oid:
                all_offer_ids.add(str(oid))

    created = 0
    updated = 0
    skipped = 0
    error_count = 0
    error_samples: list[str] = []
    user_id = str(admin["id"])

    async with pool.acquire() as conn:
        card_map: dict[str, str] = {}
        if all_offer_ids:
            card_rows = await _safe_fetch(
                conn,
                """
                SELECT id, ozon_offer_id, sku
                FROM master_cards
                WHERE user_id = $2
                  AND (ozon_offer_id = ANY($1::text[])
                    OR sku = ANY($1::text[]))
                """,
                list(all_offer_ids),
                user_id,
            )
            for row in card_rows:
                if row["ozon_offer_id"]:
                    card_map[str(row["ozon_offer_id"])] = str(row["id"])
                if row["sku"]:
                    card_map[str(row["sku"])] = str(row["id"])

        async with conn.transaction():
            for p in raw_postings:
                posting_number = p.get("posting_number", "")
                status = (p.get("status") or "").strip().lower()
                if not posting_number:
                    skipped += 1
                    continue

                sold_at = safe_parse_datetime(p.get("in_process_at") or p.get("created_at") or "")
                is_cancelled = status == "cancelled"

                # Extract items with matched cards + prices
                items_to_save: list[dict[str, Any]] = []
                for product in p.get("products") or []:
                    offer_id = str(product.get("offer_id") or "")
                    if not offer_id:
                        continue
                    card_id = card_map.get(offer_id)
                    if not card_id:
                        continue
                    qty = int(product.get("quantity") or 0)
                    if qty <= 0:
                        continue
                    price_str = str(product.get("price") or "0")
                    try:
                        unit_price = Decimal(price_str)
                    except Exception:
                        unit_price = Decimal("0")
                    items_to_save.append(
                        {
                            "master_card_id": card_id,
                            "offer_id": offer_id,
                            "quantity": qty,
                            "unit_price": unit_price,
                        }
                    )

                if not items_to_save:
                    skipped += 1
                    continue

                try:
                    # Check for existing order
                    existing = await conn.fetchrow(
                        """
                        SELECT id, status FROM sales_orders
                        WHERE marketplace = 'ozon'
                          AND external_order_id = $1
                          AND user_id = $2::uuid
                        """,
                        posting_number,
                        user_id,
                    )

                    if existing:
                        old_status = (existing["status"] or "").strip().lower()
                        was_cancelled = old_status == "cancelled"
                        order_id = str(existing["id"])

                        if not was_cancelled and is_cancelled:
                            # FIFO REVERSAL: active → cancelled
                            await reverse_fifo_allocations(conn, sales_order_id=order_id)
                            await conn.execute(
                                "UPDATE sales_orders SET status = 'cancelled' WHERE id = $1::uuid",
                                order_id,
                            )
                        elif was_cancelled and not is_cancelled:
                            # Rare: cancelled → active — run FIFO allocation
                            for item in items_to_save:
                                await _run_fifo_for_existing_item(
                                    conn,
                                    order_id=order_id,
                                    card_id=item["master_card_id"],
                                    offer_id=item["offer_id"],
                                    quantity=item["quantity"],
                                    unit_price=item["unit_price"],
                                )
                            await conn.execute(
                                "UPDATE sales_orders SET status = $1 WHERE id = $2::uuid",
                                status,
                                order_id,
                            )
                        else:
                            # Same status category — update status + backfill prices
                            await conn.execute(
                                "UPDATE sales_orders SET status = $1 WHERE id = $2::uuid",
                                status,
                                order_id,
                            )
                            for item in items_to_save:
                                if item["unit_price"] > 0:
                                    await conn.execute(
                                        """
                                        UPDATE sales_order_items
                                        SET unit_sale_price_rub = $1
                                        WHERE sales_order_id = $2::uuid
                                          AND source_offer_id = $3
                                          AND unit_sale_price_rub = 0
                                        """,
                                        item["unit_price"],
                                        order_id,
                                        item["offer_id"],
                                    )
                        updated += 1
                    else:
                        # New posting
                        if not is_cancelled:
                            # FIFO sale
                            result = await create_sale(
                                conn,
                                user_id=user_id,
                                marketplace="ozon",
                                external_order_id=posting_number,
                                sold_at=sold_at,
                                status=status,
                                items=[
                                    {
                                        "master_card_id": item["master_card_id"],
                                        "quantity": item["quantity"],
                                        "unit_sale_price_rub": item["unit_price"],
                                        "fee_rub": 0,
                                        "source_offer_id": item["offer_id"],
                                    }
                                    for item in items_to_save
                                ],
                                raw_payload=p,
                                source="ozon_fbo_sync",
                                record_finance_transactions=False,
                                allow_insufficient=True,
                            )
                            if result.get("existing"):
                                updated += 1
                            else:
                                created += 1
                        else:
                            # Cancelled from the start — record without FIFO
                            row = await conn.fetchrow(
                                """
                                INSERT INTO sales_orders
                                    (marketplace, external_order_id, sold_at, status, user_id)
                                VALUES ('ozon', $1, $2, 'cancelled', $3::uuid)
                                RETURNING id
                                """,
                                posting_number,
                                sold_at,
                                user_id,
                            )
                            order_id = str(row["id"])
                            for item in items_to_save:
                                await conn.execute(
                                    """
                                    INSERT INTO sales_order_items
                                        (sales_order_id, master_card_id, quantity,
                                         unit_sale_price_rub, source_offer_id)
                                    VALUES ($1::uuid, $2::uuid, $3, $4, $5)
                                    ON CONFLICT (sales_order_id, source_offer_id)
                                        DO NOTHING
                                    """,
                                    order_id,
                                    item["master_card_id"],
                                    Decimal(str(item["quantity"])),
                                    item["unit_price"],
                                    item["offer_id"],
                                )
                            created += 1
                except Exception as exc:
                    error_count += 1
                    if len(error_samples) < 20:
                        error_samples.append(f"{posting_number}: {str(exc)[:300]}")

            await finish_sync_run(
                conn,
                run_id=run_id,
                status_text="completed_with_errors" if (error_count or api_errors) else "completed",
                rows_processed=len(raw_postings),
                created_count=created,
                skipped_count=skipped + updated,
                error_count=error_count + len(api_errors),
                details={
                    "api_errors": api_errors[:20],
                    "error_samples": error_samples,
                },
            )

    return {
        "run_id": run_id,
        "date_from": from_date.isoformat(),
        "date_to": to_date.isoformat(),
        "total_postings": len(raw_postings),
        "created_count": created,
        "updated_count": updated,
        "skipped_count": skipped,
        "error_count": error_count + len(api_errors),
        "api_errors": api_errors[:5],
        "error_samples": error_samples[:5],
    }
