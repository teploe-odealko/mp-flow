from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def meta_current_state() -> str:
    """Get a summary of the current ERP state: product count, orders, balance,
    Ozon connection status, last sync timestamps."""
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        cards = await conn.fetchval(
            "SELECT count(*) FROM master_cards WHERE user_id = $1", deps.user_id
        )
        orders = await conn.fetchval(
            "SELECT count(*) FROM supplier_orders WHERE user_id = $1", deps.user_id
        )
        sales = await conn.fetchval(
            "SELECT count(*) FROM card_sales WHERE user_id = $1", deps.user_id
        )
        ozon_accounts = await conn.fetchval(
            "SELECT count(*) FROM admin_ozon_accounts WHERE user_id = $1 AND is_active = true",
            deps.user_id,
        )
        # Last sync freshness
        sync_rows = await conn.fetch(
            """SELECT sync_type, MAX(finished_at) AS last_sync
               FROM ozon_sync_runs
               WHERE user_id = $1 AND status = 'success'
               GROUP BY sync_type""",
            deps.user_id,
        )
        syncs = {r["sync_type"]: str(r["last_sync"]) for r in sync_rows} if sync_rows else {}

    return serialize_result(
        {
            "catalog_size": cards or 0,
            "supplier_orders": orders or 0,
            "total_sales": sales or 0,
            "ozon_connected": (ozon_accounts or 0) > 0,
            "ozon_accounts": ozon_accounts or 0,
            "last_syncs": syncs,
        }
    )
