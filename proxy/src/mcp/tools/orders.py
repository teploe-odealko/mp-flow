from datetime import date
from decimal import Decimal

from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.services.admin import order_service

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def orders_list(status_filter: str = "", limit: int = 50, offset: int = 0) -> str:
    """List supplier orders with optional status filter.

    Args:
        status_filter: Filter by status — 'draft' or 'received'. Empty = all.
        limit: Max results (default 50).
        offset: Pagination offset.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await order_service.list_orders(
            conn,
            user_id=deps.user_id,
            status_filter=status_filter or None,
            limit=min(limit, 200),
            offset=offset,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def orders_get(order_id: str) -> str:
    """Get supplier order detail with all line items.

    Args:
        order_id: UUID of the supplier order.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await order_service.get_order_detail(
            conn,
            order_id=order_id,
            user_id=deps.user_id,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def orders_create(
    supplier_name: str,
    items: list[dict],
    order_number: str = "",
    order_date: str = "",
    expected_date: str = "",
    notes: str = "",
    shared_costs: list[dict] | None = None,
) -> str:
    """Create a new supplier order with line items.

    Args:
        supplier_name: Supplier name (required).
        items: List of order items. Each item: {master_card_id, quantity, cny_price_per_unit,
               purchase_price_rub, packaging_cost_rub, logistics_cost_rub, customs_cost_rub,
               extra_cost_rub, individual_cost_rub, allocations}.
        order_number: Custom order number (auto-generated if empty).
        order_date: Order date YYYY-MM-DD (default today).
        expected_date: Expected delivery date YYYY-MM-DD.
        notes: Free-text notes.
        shared_costs: Shared costs list [{name, amount_rub, allocation_method}].
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await order_service.create_order(
            conn,
            user_id=deps.user_id,
            order_number=order_number or None,
            supplier_name=supplier_name,
            order_date=date.fromisoformat(order_date) if order_date else None,
            expected_date=date.fromisoformat(expected_date) if expected_date else None,
            notes=notes or None,
            shared_costs=shared_costs or [],
            items=items,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def orders_update(
    order_id: str,
    supplier_name: str,
    items: list[dict],
    order_date: str = "",
    expected_date: str = "",
    notes: str = "",
    shared_costs: list[dict] | None = None,
) -> str:
    """Update a draft supplier order (replaces all items).

    Args:
        order_id: UUID of the supplier order.
        supplier_name: Updated supplier name.
        items: Full replacement list of order items (same format as orders_create).
        order_date: Order date YYYY-MM-DD.
        expected_date: Expected delivery date YYYY-MM-DD.
        notes: Free-text notes.
        shared_costs: Shared costs list.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await order_service.update_order(
            conn,
            order_id=order_id,
            user_id=deps.user_id,
            supplier_name=supplier_name,
            order_date=date.fromisoformat(order_date) if order_date else None,
            expected_date=date.fromisoformat(expected_date) if expected_date else None,
            notes=notes or None,
            shared_costs=shared_costs or [],
            items=items,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def orders_delete(order_id: str) -> str:
    """Delete a draft supplier order. Only draft orders can be deleted.

    Args:
        order_id: UUID of the supplier order.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await order_service.delete_order(
            conn,
            order_id=order_id,
            user_id=deps.user_id,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def orders_receive(order_id: str, received_quantities: dict | None = None) -> str:
    """Receive a supplier order — creates FIFO inventory lots and a purchase finance transaction.

    Args:
        order_id: UUID of the supplier order to receive.
        received_quantities: Optional dict {item_id: received_qty}. If omitted,
                            receives all items at ordered quantities.
    """
    deps = get_deps()
    recv_map = None
    if received_quantities:
        recv_map = {k: Decimal(str(v)) for k, v in received_quantities.items()}
    async with deps.pool.acquire() as conn:
        result = await order_service.receive_order(
            conn,
            order_id=order_id,
            user_id=deps.user_id,
            recv_map=recv_map,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def orders_unreceive(order_id: str) -> str:
    """Reverse a received order — deletes FIFO lots, reverses stock movements,
    removes the purchase transaction, returns order to draft status.

    Args:
        order_id: UUID of the supplier order.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await order_service.unreceive_order(
            conn,
            order_id=order_id,
            user_id=deps.user_id,
        )
    return serialize_result(result)
