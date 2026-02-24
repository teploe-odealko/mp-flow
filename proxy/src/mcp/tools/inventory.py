from decimal import Decimal

from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.services.admin import inventory_service

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def inventory_overview() -> str:
    """Get inventory overview: per-SKU stock summary, active FIFO lots,
    and total stock valuation in RUB."""
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await inventory_service.get_inventory_overview(conn, user_id=deps.user_id)
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def inventory_initial_balance(items: list[dict]) -> str:
    """Onboard existing stock as initial balance. Creates a pseudo-order, FIFO lots,
    stock movements, and a purchase finance transaction.

    Args:
        items: List of {master_card_id: str, quantity: number, unit_cost_rub: number}.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await inventory_service.create_initial_balance(
            conn,
            user_id=deps.user_id,
            items=items,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def inventory_adjust(
    master_card_id: str,
    quantity_delta: float,
    notes: str = "",
) -> str:
    """Manual inventory adjustment. Positive = add stock (creates lot at avg cost),
    negative = remove stock (FIFO deduction from oldest lots).

    Args:
        master_card_id: UUID of the master card.
        quantity_delta: Quantity change (positive to add, negative to remove).
        notes: Reason for adjustment.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await inventory_service.adjust_inventory(
            conn,
            user_id=deps.user_id,
            master_card_id=master_card_id,
            quantity_delta=Decimal(str(quantity_delta)),
            notes=notes or None,
        )
    return serialize_result(result)
