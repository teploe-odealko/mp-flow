from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool, require_admin
from proxy.src.routes.admin.response_models import (
    InitialBalanceResponse,
    InventoryAdjustmentResponse,
    InventoryOverviewResponse,
)
from proxy.src.services.admin import inventory_service
from pydantic import BaseModel, Field

router = APIRouter(tags=["Inventory"])


class InitialBalanceItem(BaseModel):
    master_card_id: str
    quantity: Decimal = Field(gt=0)
    unit_cost_rub: Decimal = Field(ge=0)


class InitialBalanceRequest(BaseModel):
    items: list[InitialBalanceItem] = Field(min_length=1)


@router.post("/inventory/initial-balance", response_model=InitialBalanceResponse)
async def create_initial_balance(
    payload: InitialBalanceRequest,
    request: Request,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Ввод начальных остатков: создаёт FIFO-лоты для существующего товара на складе."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await inventory_service.create_initial_balance(
                conn,
                user_id=str(user["id"]),
                items=[item.model_dump(mode="json") for item in payload.items],
            )


class InventoryAdjustmentRequest(BaseModel):
    master_card_id: str
    quantity_delta: Decimal
    notes: str | None = None


@router.post("/inventory/adjustment", response_model=InventoryAdjustmentResponse)
async def create_inventory_adjustment(
    payload: InventoryAdjustmentRequest,
    request: Request,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Ручная корректировка остатков (+/−). Для инвентаризации и списаний."""
    if payload.quantity_delta == 0:
        raise HTTPException(status_code=400, detail="quantity_delta must not be zero")
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await inventory_service.adjust_inventory(
                conn,
                user_id=str(user["id"]),
                master_card_id=payload.master_card_id,
                quantity_delta=payload.quantity_delta,
                notes=payload.notes,
            )


@router.get("/inventory", response_model=InventoryOverviewResponse)
async def inventory_overview(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Обзор остатков по всем карточкам: количество, себестоимость, стоимость на складе."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await inventory_service.get_inventory_overview(conn, user_id=str(user["id"]))
