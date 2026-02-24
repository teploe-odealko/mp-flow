from fastapi import HTTPException
from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.services.admin import loss_service

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def logistics_matrix() -> str:
    """Get the SKU supply chain matrix: per-product view of stock across
    supplier pipeline, home warehouse, and Ozon warehouses.
    Shows: ordered qty, received qty, warehouse stock, shipped to Ozon,
    accepted by Ozon, losses, current Ozon stock."""
    from proxy.src.repositories.admin.base import safe_fetch

    deps = get_deps()
    async with deps.pool.acquire() as conn:
        rows = await safe_fetch(
            conn,
            """SELECT mc.id, mc.sku, mc.title, mc.warehouse_qty,
                      COALESCE(SUM(soi.quantity), 0) AS ordered_qty,
                      COALESCE(SUM(soi.received_qty), 0) AS received_qty
               FROM master_cards mc
               LEFT JOIN supplier_order_items soi ON soi.master_card_id = mc.id
               WHERE mc.user_id = $1 AND mc.status != 'archived'
               GROUP BY mc.id ORDER BY mc.title""",
            deps.user_id,
        )
    items = [dict(r) for r in (rows or [])]
    return serialize_result({"items": items, "total": len(items)})


@mcp.tool()
@mcp_error_handler
async def logistics_supplies(limit: int = 50, offset: int = 0) -> str:
    """List Ozon supply orders (shipments to Ozon warehouses).

    Args:
        limit: Max results (default 50).
        offset: Pagination offset.
    """
    from proxy.src.repositories.admin.base import safe_fetch

    deps = get_deps()
    async with deps.pool.acquire() as conn:
        rows = await safe_fetch(
            conn,
            """SELECT id, ozon_supply_order_id, supply_number, status,
                      warehouse_name, created_at, accepted_at, total_items_planned,
                      total_items_accepted, warehouse_deducted
               FROM ozon_supplies
               WHERE user_id = $1
               ORDER BY created_at DESC
               LIMIT $2 OFFSET $3""",
            deps.user_id,
            min(limit, 200),
            offset,
        )
    items = [dict(r) for r in (rows or [])]
    return serialize_result({"items": items, "total": len(items)})


@mcp.tool()
@mcp_error_handler
async def logistics_sku_detail(master_card_id: str) -> str:
    """Get detailed supply chain lifecycle for a specific SKU:
    supplier orders, FIFO lots, Ozon supply shipments, sales, returns.

    Args:
        master_card_id: UUID of the master card.
    """
    from proxy.src.repositories.admin.base import safe_fetch, safe_fetchone

    deps = get_deps()
    async with deps.pool.acquire() as conn:
        card = await safe_fetchone(
            conn,
            "SELECT id, title, sku, warehouse_qty FROM master_cards WHERE id = $1 AND user_id = $2",
            master_card_id,
            deps.user_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Master card not found")

        lots = await safe_fetch(
            conn,
            """SELECT id, initial_qty, remaining_qty, unit_cost_rub, received_at
               FROM inventory_lots WHERE master_card_id = $1 ORDER BY received_at""",
            master_card_id,
        )
        supplies = await safe_fetch(
            conn,
            """SELECT osi.*, os.supply_number, os.status AS supply_status
               FROM ozon_supply_items osi
               JOIN ozon_supplies os ON os.id = osi.ozon_supply_id
               WHERE osi.master_card_id = $1 AND os.user_id = $2
               ORDER BY os.created_at DESC""",
            master_card_id,
            deps.user_id,
        )
        movements = await safe_fetch(
            conn,
            """SELECT movement_type, quantity, created_at, notes
               FROM stock_movements WHERE master_card_id = $1 AND user_id = $2
               ORDER BY created_at DESC LIMIT 20""",
            master_card_id,
            deps.user_id,
        )

    return serialize_result(
        {
            "card": dict(card),
            "lots": [dict(r) for r in (lots or [])],
            "supplies": [dict(r) for r in (supplies or [])],
            "recent_movements": [dict(r) for r in (movements or [])],
        }
    )


@mcp.tool()
@mcp_error_handler
async def logistics_write_off_loss(master_card_id: str) -> str:
    """Write off supply losses for a SKU. Deducts from FIFO lots,
    creates expense finance transaction, marks supply items as written off.

    Args:
        master_card_id: UUID of the master card with supply losses.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await loss_service.write_off_supply_loss(
            conn,
            user_id=deps.user_id,
            master_card_id=master_card_id,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def logistics_write_off_discrepancy(
    master_card_id: str, quantity: int, notes: str = ""
) -> str:
    """Write off inventory discrepancy. FIFO deduction + expense transaction.

    Args:
        master_card_id: UUID of the master card.
        quantity: Number of units to write off (positive integer).
        notes: Reason for write-off.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await loss_service.write_off_discrepancy(
            conn,
            user_id=deps.user_id,
            master_card_id=master_card_id,
            quantity=quantity,
            notes=notes or None,
        )
    return serialize_result(result)
