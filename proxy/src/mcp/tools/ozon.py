from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.routes.admin_ozon import ozon_post, resolve_ozon_creds

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def ozon_api(path: str, body: dict | None = None) -> str:
    """Generic Ozon Seller API proxy. Forwards any POST request to Ozon API
    using stored encrypted credentials.

    Example: ozon_api('/v1/product/list', {'filter': {}, 'limit': 100})

    Args:
        path: Ozon API endpoint path (e.g. '/v4/product/info/stocks').
        body: Request body as dict (default empty dict).
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=deps.user_id,
            client_id=None,
            api_key=None,
        )
        result = await ozon_post(path, body or {}, client_id=client_id, api_key=api_key)
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def ozon_sync_freshness() -> str:
    """Get last successful sync timestamps per sync type (sales, finance, stocks, etc.)."""
    from proxy.src.repositories.admin.base import safe_fetch

    deps = get_deps()
    async with deps.pool.acquire() as conn:
        rows = await safe_fetch(
            conn,
            """SELECT sync_type, MAX(finished_at) AS last_synced_at
               FROM ozon_sync_runs
               WHERE user_id = $1 AND status LIKE 'completed%'
               GROUP BY sync_type""",
            deps.user_id,
        )
    syncs = {r["sync_type"]: str(r["last_synced_at"]) for r in rows} if rows else {}
    return serialize_result({"syncs": syncs})


@mcp.tool()
@mcp_error_handler
async def ozon_stocks() -> str:
    """Get current stock levels from DB (warehouse_qty on master cards).
    For fresh data, first sync via ozon_sync_warehouse_stock, then call this."""
    from proxy.src.repositories.admin.base import safe_fetch

    deps = get_deps()
    async with deps.pool.acquire() as conn:
        rows = await safe_fetch(
            conn,
            """SELECT id, title, sku, ozon_offer_id, ozon_product_id, warehouse_qty
               FROM master_cards
               WHERE user_id = $1 AND status = 'active'
               ORDER BY warehouse_qty DESC NULLS LAST""",
            deps.user_id,
        )
    items = [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "sku": r["sku"],
            "ozon_offer_id": r["ozon_offer_id"],
            "warehouse_qty": float(r["warehouse_qty"] or 0),
        }
        for r in (rows or [])
    ]
    return serialize_result({"items": items, "total": len(items)})


@mcp.tool()
@mcp_error_handler
async def ozon_sync_sales(date_from: str = "", date_to: str = "") -> str:
    """Sync FBO postings from Ozon → create sales + FIFO allocations.
    Calls Ozon /v3/posting/fbo/list, matches postings to master cards,
    creates sales orders with FIFO COGS.

    Args:
        date_from: Start date YYYY-MM-DD (default 30 days ago).
        date_to: End date YYYY-MM-DD (default today).
    """
    from datetime import datetime, timedelta, timezone

    from proxy.src.routes.admin_helpers import _safe_fetch
    from proxy.src.services.admin.sales_service import create_sale

    deps = get_deps()
    today = datetime.now(tz=timezone.utc).date()
    from_d = (
        datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else today - timedelta(days=30)
    )
    to_d = datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else today

    async with deps.pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=deps.user_id,
            client_id=None,
            api_key=None,
        )

        # Build offer_id → card_id mapping
        card_rows = await _safe_fetch(
            conn,
            "SELECT id, ozon_offer_id FROM master_cards WHERE user_id = $1 AND ozon_offer_id IS NOT NULL",
            deps.user_id,
        )
        offer_to_card = {r["ozon_offer_id"]: str(r["id"]) for r in (card_rows or [])}

    # Fetch postings from Ozon
    all_postings = []
    offset = 0
    while True:
        data = await ozon_post(
            "/v3/posting/fbo/list",
            {
                "dir": "ASC",
                "filter": {
                    "since": f"{from_d}T00:00:00Z",
                    "to": f"{to_d}T23:59:59Z",
                    "status": "",
                },
                "limit": 1000,
                "offset": offset,
                "with": {"analytics_data": False, "financial_data": True},
            },
            client_id=client_id,
            api_key=api_key,
        )
        postings = data.get("result") or []
        if not postings:
            break
        all_postings.extend(postings)
        if len(postings) < 1000:
            break
        offset += len(postings)

    # Process postings into sales
    created = 0
    skipped = 0
    for posting in all_postings:
        posting_number = posting.get("posting_number", "")
        status = posting.get("status", "")
        if status not in ("delivered", "awaiting_deliver"):
            skipped += 1
            continue

        items = []
        for prod in posting.get("products") or []:
            offer_id = prod.get("offer_id", "")
            card_id = offer_to_card.get(offer_id)
            if not card_id:
                continue
            items.append(
                {
                    "master_card_id": card_id,
                    "quantity": prod.get("quantity", 1),
                    "unit_sale_price_rub": float(prod.get("price", "0")),
                    "fee_rub": 0,
                    "source_offer_id": offer_id,
                }
            )

        if not items:
            skipped += 1
            continue

        try:
            async with deps.pool.acquire() as conn:
                await create_sale(
                    conn,
                    user_id=deps.user_id,
                    marketplace="ozon",
                    external_order_id=posting_number,
                    sold_at=datetime.fromisoformat(
                        posting.get("created_at", "").replace("Z", "+00:00")
                    )
                    if posting.get("created_at")
                    else None,
                    status=status,
                    items=items,
                    raw_payload=posting,
                    source="ozon_sync",
                    allow_insufficient=True,
                )
            created += 1
        except Exception:
            skipped += 1

    return serialize_result(
        {
            "synced_postings": len(all_postings),
            "created": created,
            "skipped": skipped,
            "date_from": from_d.isoformat(),
            "date_to": to_d.isoformat(),
        }
    )


@mcp.tool()
@mcp_error_handler
async def ozon_sync_finance(date_from: str = "", date_to: str = "") -> str:
    """Sync finance transactions from Ozon → finance_transactions table.

    Args:
        date_from: Start date YYYY-MM-DD (default 30 days ago).
        date_to: End date YYYY-MM-DD (default today).
    """
    from datetime import datetime, timedelta, timezone

    from proxy.src.routes.admin_helpers import _safe_execute
    from proxy.src.services.admin_logic import parse_ozon_finance_transactions

    deps = get_deps()
    today = datetime.now(tz=timezone.utc).date()
    from_d = (
        datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else today - timedelta(days=30)
    )
    to_d = datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else today

    async with deps.pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=deps.user_id,
            client_id=None,
            api_key=None,
        )

    # Fetch from Ozon
    all_operations = []
    page = 1
    while True:
        data = await ozon_post(
            "/v3/finance/transaction/list",
            {
                "filter": {
                    "date": {"from": f"{from_d}T00:00:00Z", "to": f"{to_d}T23:59:59Z"},
                    "transaction_type": "all",
                },
                "page": page,
                "page_size": 1000,
            },
            client_id=client_id,
            api_key=api_key,
        )
        operations = data.get("result", {}).get("operations") or []
        if not operations:
            break
        all_operations.extend(operations)
        if len(operations) < 1000:
            break
        page += 1

    # Parse and upsert
    parsed = parse_ozon_finance_transactions({"result": {"operations": all_operations}})
    upserted = 0
    async with deps.pool.acquire() as conn:
        for txn in parsed:
            await _safe_execute(
                conn,
                """INSERT INTO finance_transactions
                   (happened_at, kind, category, amount_rub, source, external_id, notes, payload, user_id)
                   VALUES ($1, $2, $3, $4, 'ozon', $5, $6, $7, $8)
                   ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL
                   DO UPDATE SET amount_rub = EXCLUDED.amount_rub, notes = EXCLUDED.notes""",
                txn["happened_at"],
                txn["kind"],
                txn["category"],
                txn["amount_rub"],
                txn.get("external_id"),
                txn.get("notes"),
                txn.get("payload", "{}"),
                deps.user_id,
            )
            upserted += 1

    return serialize_result(
        {
            "fetched": len(all_operations),
            "upserted": upserted,
            "date_from": from_d.isoformat(),
            "date_to": to_d.isoformat(),
        }
    )


@mcp.tool()
@mcp_error_handler
async def ozon_import_products() -> str:
    """Import product catalog from Ozon into master_cards.
    Fetches all products via /v3/product/list + /v3/product/info/list,
    creates or updates master cards."""
    from proxy.src.routes.admin_ozon import load_ozon_products

    deps = get_deps()
    async with deps.pool.acquire() as conn:
        client_id, api_key = await resolve_ozon_creds(
            conn,
            admin_user_id=deps.user_id,
            client_id=None,
            api_key=None,
        )

    products, _ = await load_ozon_products(
        client_id=client_id,
        api_key=api_key,
        page_size=1000,
        max_pages=50,
    )

    created = 0
    updated = 0
    async with deps.pool.acquire() as conn:
        for prod in products:
            offer_id = prod.get("offer_id", "")
            product_id = str(prod.get("id", ""))
            name = prod.get("name", "Без названия")

            existing = await conn.fetchrow(
                "SELECT id FROM master_cards WHERE user_id = $1 AND ozon_offer_id = $2",
                deps.user_id,
                offer_id,
            )
            if existing:
                await conn.execute(
                    """UPDATE master_cards SET title = COALESCE(NULLIF($3, ''), title),
                       ozon_product_id = $4 WHERE id = $1 AND user_id = $2""",
                    str(existing["id"]),
                    deps.user_id,
                    name,
                    product_id,
                )
                updated += 1
            else:
                await conn.execute(
                    """INSERT INTO master_cards (title, ozon_offer_id, ozon_product_id, user_id, status)
                       VALUES ($1, $2, $3, $4, 'active')""",
                    name,
                    offer_id,
                    product_id,
                    deps.user_id,
                )
                created += 1

    return serialize_result(
        {
            "total_products": len(products),
            "created": created,
            "updated": updated,
        }
    )
