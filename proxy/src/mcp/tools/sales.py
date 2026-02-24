from datetime import datetime

from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.services.admin import sales_service

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def sales_list(limit: int = 50, offset: int = 0) -> str:
    """List sales orders with FIFO allocations.

    Args:
        limit: Max results (default 50).
        offset: Pagination offset.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await sales_service.list_sales(
            conn,
            user_id=deps.user_id,
            limit=min(limit, 200),
            offset=offset,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def sales_create(
    items: list[dict],
    marketplace: str = "manual",
    external_order_id: str = "",
    sold_at: str = "",
    status: str = "delivered",
) -> str:
    """Create a sale with FIFO cost allocation. Creates finance transactions automatically.

    Args:
        items: List of sold items. Each: {master_card_id, quantity, unit_sale_price_rub,
               fee_rub (optional), extra_cost_rub (optional)}.
        marketplace: Marketplace name (default 'manual').
        external_order_id: External order ID for deduplication.
        sold_at: Sale datetime ISO 8601 (default now).
        status: Order status (default 'delivered').
    """
    deps = get_deps()
    effective_sold_at = datetime.fromisoformat(sold_at) if sold_at else None
    async with deps.pool.acquire() as conn:
        result = await sales_service.create_sale(
            conn,
            user_id=deps.user_id,
            marketplace=marketplace or None,
            external_order_id=external_order_id or None,
            sold_at=effective_sold_at,
            status=status,
            items=items,
            raw_payload={},
            source="mcp",
            allow_insufficient=True,
        )
    return serialize_result(result)
