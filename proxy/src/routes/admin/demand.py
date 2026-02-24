"""
Demand planning API endpoints.

POST /demand/generate          — Generate new supply plan
GET  /demand/plans             — List plans
GET  /demand/plans/{id}        — Get plan detail
PATCH /demand/plans/{id}/items/{item_id} — Adjust qty
POST /demand/plans/{id}/confirm — Confirm plan
GET  /demand/params            — List planning params
PUT  /demand/params/{card_id}  — Upsert params
GET  /demand/cluster-targets   — List cluster targets
PUT  /demand/cluster-targets/{card_id}/{cluster_id} — Upsert target
GET  /demand/cluster-stock     — Get current cluster stock snapshot
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.list_query import ListQuery, list_query_dep
from proxy.src.routes.admin.response_models import (
    ClusterStockResponse,
    ClusterTargetItemResponse,
    ClusterTargetsResponse,
    DemandParamItemResponse,
    DemandParamsResponse,
    DemandPlanItemResponse,
    DemandPlanResponse,
    DemandPlansListResponse,
)
from proxy.src.services.admin.demand_service import (
    confirm_plan,
    generate_supply_plan,
    get_cluster_targets,
    get_planning_params,
    get_supply_plan,
    list_supply_plans,
    update_plan_item_qty,
    upsert_cluster_target,
    upsert_planning_params,
)
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Demand"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class GeneratePlanRequest(BaseModel):
    lead_time_days: int = 45
    buffer_days: int = 60


class AdjustQtyRequest(BaseModel):
    adjusted_qty: int


class PlanningParamsRequest(BaseModel):
    target_stock_days: int = 45
    safety_stock_qty: int = 0
    supplier_lead_days: int = 45
    moq: int = 1
    pack_size: int = 1
    enabled: bool = True


class ClusterTargetRequest(BaseModel):
    cluster_name: str | None = None
    estimated_daily_sales: float | None = None
    initial_stock_target: int | None = None
    target_stock_days: int = 45
    enabled: bool = True


# ---------------------------------------------------------------------------
# POST /demand/generate
# ---------------------------------------------------------------------------


@router.post("/demand/generate", response_model=DemandPlanResponse)
async def api_generate_plan(
    payload: GeneratePlanRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Generate a new demand-based supply plan."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await generate_supply_plan(
                conn,
                user_id=str(admin["id"]),
                lead_time_days=payload.lead_time_days,
                buffer_days=payload.buffer_days,
            )
    return result


# ---------------------------------------------------------------------------
# GET /demand/plans
# ---------------------------------------------------------------------------


PLANS_SORT_FIELDS = {"created_at"}


@router.get("/demand/plans", response_model=DemandPlansListResponse)
async def api_list_plans(
    request: Request,
    lq: ListQuery = Depends(
        list_query_dep(allowed_sort=PLANS_SORT_FIELDS, default_sort="created_at:desc")
    ),
    status: str | None = Query(default=None),
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """List supply plans with pagination and sort."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await list_supply_plans(
            conn, user_id=str(admin["id"]), lq=lq, status_filter=status
        )
    return result


# ---------------------------------------------------------------------------
# GET /demand/plans/{plan_id}
# ---------------------------------------------------------------------------


@router.get("/demand/plans/{plan_id}", response_model=DemandPlanResponse)
async def api_get_plan(
    plan_id: int,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Get plan with items and cluster breakdowns."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await get_supply_plan(conn, user_id=str(admin["id"]), plan_id=plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found")
    return result


# ---------------------------------------------------------------------------
# PATCH /demand/plans/{plan_id}/items/{item_id}
# ---------------------------------------------------------------------------


@router.patch("/demand/plans/{plan_id}/items/{item_id}", response_model=DemandPlanItemResponse)
async def api_adjust_item(
    plan_id: int,
    item_id: int,
    payload: AdjustQtyRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Update adjusted_qty for a plan item."""
    if payload.adjusted_qty < 0:
        raise HTTPException(status_code=400, detail="adjusted_qty must be >= 0")
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await update_plan_item_qty(
            conn,
            user_id=str(admin["id"]),
            plan_id=plan_id,
            item_id=item_id,
            adjusted_qty=payload.adjusted_qty,
        )
    if not result:
        raise HTTPException(status_code=404, detail="Item not found")
    return result


# ---------------------------------------------------------------------------
# POST /demand/plans/{plan_id}/confirm
# ---------------------------------------------------------------------------


@router.post("/demand/plans/{plan_id}/confirm", response_model=DemandPlanResponse)
async def api_confirm_plan(
    plan_id: int,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Confirm a draft plan."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await confirm_plan(conn, user_id=str(admin["id"]), plan_id=plan_id)
    if not result:
        raise HTTPException(status_code=404, detail="Plan not found or not in draft status")
    return result


# ---------------------------------------------------------------------------
# GET /demand/params
# ---------------------------------------------------------------------------


@router.get("/demand/params", response_model=DemandParamsResponse)
async def api_get_params(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Get planning params for all SKUs."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        params = await get_planning_params(conn, user_id=str(admin["id"]))
    return {"params": params}


# ---------------------------------------------------------------------------
# PUT /demand/params/{master_card_id}
# ---------------------------------------------------------------------------


@router.put("/demand/params/{master_card_id}", response_model=DemandParamItemResponse)
async def api_upsert_params(
    master_card_id: str,
    payload: PlanningParamsRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Create or update planning params for a SKU."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await upsert_planning_params(
            conn,
            user_id=str(admin["id"]),
            master_card_id=master_card_id,
            params=payload.model_dump(),
        )
    return result


# ---------------------------------------------------------------------------
# GET /demand/cluster-targets
# ---------------------------------------------------------------------------


@router.get("/demand/cluster-targets", response_model=ClusterTargetsResponse)
async def api_get_cluster_targets(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Get cluster targets."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        targets = await get_cluster_targets(conn, user_id=str(admin["id"]))
    return {"targets": targets}


# ---------------------------------------------------------------------------
# PUT /demand/cluster-targets/{master_card_id}/{cluster_id}
# ---------------------------------------------------------------------------


@router.put(
    "/demand/cluster-targets/{master_card_id}/{cluster_id}",
    response_model=ClusterTargetItemResponse,
)
async def api_upsert_cluster_target(
    master_card_id: str,
    cluster_id: int,
    payload: ClusterTargetRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Create or update a cluster target."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await upsert_cluster_target(
            conn,
            user_id=str(admin["id"]),
            master_card_id=master_card_id,
            cluster_id=cluster_id,
            params=payload.model_dump(),
        )
    return result


# ---------------------------------------------------------------------------
# GET /demand/cluster-stock
# ---------------------------------------------------------------------------


@router.get("/demand/cluster-stock", response_model=ClusterStockResponse)
async def api_get_cluster_stock(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Get current cluster stock snapshot (last sync data)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ocs.*, mc.title AS card_title, mc.sku AS card_sku
            FROM ozon_cluster_stock ocs
            LEFT JOIN master_cards mc ON mc.id = ocs.master_card_id
            WHERE ocs.user_id = $1
            ORDER BY ocs.ozon_sku, ocs.cluster_id
            """,
            str(admin["id"]),
        )
        synced_row = await conn.fetchrow(
            "SELECT MAX(synced_at) AS last_sync FROM ozon_cluster_stock WHERE user_id = $1",
            str(admin["id"]),
        )

    last_sync = synced_row["last_sync"] if synced_row else None

    items = []
    for r in rows:
        items.append(
            {
                "ozon_sku": r["ozon_sku"],
                "offer_id": r["offer_id"],
                "master_card_id": str(r["master_card_id"]) if r["master_card_id"] else None,
                "card_title": r["card_title"],
                "card_sku": r["card_sku"],
                "cluster_id": r["cluster_id"],
                "cluster_name": r["cluster_name"],
                "warehouse_id": r["warehouse_id"],
                "warehouse_name": r["warehouse_name"],
                "available": r["available"],
                "in_transit": r["in_transit"],
                "reserved": r["reserved"],
                "ads_cluster": float(r["ads_cluster"]) if r["ads_cluster"] else None,
                "idc_cluster": r["idc_cluster"],
                "turnover_cluster": r["turnover_cluster"],
                "days_no_sales_cluster": r["days_no_sales_cluster"],
                "ads_global": float(r["ads_global"]) if r["ads_global"] else None,
                "idc_global": r["idc_global"],
                "turnover_global": r["turnover_global"],
                "item_tags": r["item_tags"],
            }
        )

    return {
        "items": items,
        "total": len(items),
        "synced_at": last_sync.isoformat() if last_sync else None,
    }
