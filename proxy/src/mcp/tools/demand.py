from fastapi import HTTPException
from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.services.admin import demand_service

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def demand_generate_plan(lead_time_days: int = 45, buffer_days: int = 60) -> str:
    """Generate a demand-based supply plan for all active SKUs.
    Uses Ozon cluster stock analytics + two-horizon planning algorithm.

    Args:
        lead_time_days: Days until supplier order arrives (default 45).
        buffer_days: Days of stock to maintain after arrival (default 60).
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.generate_supply_plan(
            conn,
            deps.user_id,
            lead_time_days=lead_time_days,
            buffer_days=buffer_days,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def demand_list_plans(status_filter: str = "") -> str:
    """List all supply plans.

    Args:
        status_filter: Filter by status — 'draft' or 'confirmed'. Empty = all.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.list_supply_plans(
            conn,
            deps.user_id,
            status_filter=status_filter or None,
        )
    return serialize_result({"plans": result})


@mcp.tool()
@mcp_error_handler
async def demand_get_plan(plan_id: int) -> str:
    """Get full supply plan detail with per-SKU breakdown and cluster analysis.

    Args:
        plan_id: Supply plan ID.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.get_supply_plan(conn, deps.user_id, plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Supply plan not found")
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def demand_adjust_item(plan_id: int, item_id: int, adjusted_qty: int) -> str:
    """Adjust quantity for a specific item in a draft supply plan.

    Args:
        plan_id: Supply plan ID.
        item_id: Plan item ID.
        adjusted_qty: New adjusted quantity.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.update_plan_item_qty(
            conn,
            deps.user_id,
            plan_id,
            item_id,
            adjusted_qty,
        )
    if not result:
        raise HTTPException(status_code=404, detail="Plan item not found")
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def demand_confirm_plan(plan_id: int) -> str:
    """Confirm a draft supply plan (changes status from 'draft' to 'confirmed').

    Args:
        plan_id: Supply plan ID.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.confirm_plan(conn, deps.user_id, plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found or not in draft status")
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def demand_get_params() -> str:
    """Get supply planning parameters for all SKUs (MOQ, pack size, lead time, etc.)."""
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.get_planning_params(conn, deps.user_id)
    return serialize_result({"params": result})


@mcp.tool()
@mcp_error_handler
async def demand_set_params(master_card_id: str, params: dict) -> str:
    """Set supply planning parameters for a SKU.

    Args:
        master_card_id: UUID of the master card.
        params: Dict with keys: target_stock_days, safety_stock_qty,
                supplier_lead_days, moq, pack_size, enabled.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.upsert_planning_params(
            conn,
            deps.user_id,
            master_card_id,
            params,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def demand_get_cluster_targets() -> str:
    """Get cluster targets for all SKUs (manual daily sales estimates per cluster)."""
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.get_cluster_targets(conn, deps.user_id)
    return serialize_result({"targets": result})


@mcp.tool()
@mcp_error_handler
async def demand_set_cluster_target(master_card_id: str, cluster_id: int, params: dict) -> str:
    """Set cluster target for a SKU (manual daily sales estimate for a cluster).

    Args:
        master_card_id: UUID of the master card.
        cluster_id: Ozon cluster ID.
        params: Dict with keys: cluster_name, estimated_daily_sales,
                initial_stock_target, target_stock_days, enabled.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await demand_service.upsert_cluster_target(
            conn,
            deps.user_id,
            master_card_id,
            cluster_id,
            params,
        )
    return serialize_result(result)
