from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool, require_admin
from proxy.src.routes.admin.list_query import ListQuery, list_query_dep
from proxy.src.routes.admin.response_models import (
    DeletedResponse,
    OrderDetailResponse,
    OrdersListResponse,
    ReceiveResponse,
    UnreceivedResponse,
)
from proxy.src.services.admin import order_service
from pydantic import BaseModel, Field

router = APIRouter(tags=["Orders"])


class AllocationEntry(BaseModel):
    name: str
    allocated_rub: Decimal = Field(ge=0)


class SupplierOrderItemCreate(BaseModel):
    master_card_id: str | None = None
    title: str | None = None
    quantity: Decimal = Field(gt=0)
    cny_price_per_unit: Decimal = Field(default=Decimal("0"), ge=0)
    individual_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    allocations: list[AllocationEntry] = Field(default_factory=list)
    purchase_price_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    packaging_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    logistics_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    customs_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    extra_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)


class SharedCost(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    total_rub: Decimal = Field(ge=0)
    method: str = Field(pattern="^(by_cny_price|by_volume|by_weight|equal)$")


class SupplierOrderCreateRequest(BaseModel):
    order_number: str | None = Field(default=None, max_length=60)
    supplier_name: str = Field(min_length=1, max_length=500)
    order_date: date | None = None
    expected_date: date | None = None
    notes: str | None = None
    shared_costs: list[SharedCost] = Field(default_factory=list)
    items: list[SupplierOrderItemCreate] = Field(min_length=1)


class ReceiveItemEntry(BaseModel):
    item_id: str
    received_qty: Decimal = Field(ge=0)


class ReceiveOrderRequest(BaseModel):
    items: list[ReceiveItemEntry] = Field(min_length=1)


ORDERS_SORT_FIELDS = {"created_at", "order_date", "supplier_name"}


@router.get("/supplier-orders", response_model=OrdersListResponse)
async def list_supplier_orders(
    request: Request,
    lq: ListQuery = Depends(
        list_query_dep(allowed_sort=ORDERS_SORT_FIELDS, default_sort="created_at:desc")
    ),
    status_filter: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Список заказов поставщикам с поиском и фильтром по статусу."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await order_service.list_orders(
            conn, user_id=str(user["id"]), lq=lq, status_filter=status_filter
        )


@router.post("/supplier-orders", response_model=OrderDetailResponse)
async def create_supplier_order(
    payload: SupplierOrderCreateRequest,
    request: Request,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Создание заказа поставщику с позициями и распределением общих затрат."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await order_service.create_order(
                conn,
                user_id=str(user["id"]),
                order_number=payload.order_number,
                supplier_name=payload.supplier_name,
                order_date=payload.order_date,
                expected_date=payload.expected_date,
                notes=payload.notes,
                shared_costs=[sc.model_dump(mode="json") for sc in payload.shared_costs],
                items=[item.model_dump(mode="json") for item in payload.items],
            )


@router.get("/supplier-orders/{order_id}", response_model=OrderDetailResponse)
async def get_supplier_order(
    order_id: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Детали заказа с позициями, аллокациями и FIFO-лотами."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await order_service.get_order_detail(
            conn, order_id=order_id, user_id=str(user["id"])
        )


@router.put("/supplier-orders/{order_id}", response_model=OrderDetailResponse)
async def update_supplier_order(
    order_id: str,
    payload: SupplierOrderCreateRequest,
    request: Request,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Полное обновление заказа (замена позиций и затрат)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await order_service.update_order(
                conn,
                order_id=order_id,
                user_id=str(user["id"]),
                supplier_name=payload.supplier_name,
                order_date=payload.order_date,
                expected_date=payload.expected_date,
                notes=payload.notes,
                shared_costs=[sc.model_dump(mode="json") for sc in payload.shared_costs],
                items=[item.model_dump(mode="json") for item in payload.items],
            )


@router.delete("/supplier-orders/{order_id}", response_model=DeletedResponse)
async def delete_supplier_order(
    order_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Удаление черновика заказа (только статус draft)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await order_service.delete_order(conn, order_id=order_id, user_id=str(user["id"]))


@router.post("/supplier-orders/{order_id}/receive", response_model=ReceiveResponse)
async def receive_supplier_order(
    order_id: str,
    payload: ReceiveOrderRequest | None = None,
    request: Request = None,  # type: ignore[assignment]
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Оприходование заказа → создание FIFO-лотов на складе."""
    pool = get_db_pool(request)
    recv_map: dict[str, Decimal] = {}
    if payload and payload.items:
        for entry in payload.items:
            recv_map[entry.item_id] = entry.received_qty

    async with pool.acquire() as conn:
        async with conn.transaction():
            return await order_service.receive_order(
                conn,
                order_id=order_id,
                user_id=str(user["id"]),
                recv_map=recv_map or None,
            )


@router.post("/supplier-orders/{order_id}/unreceive", response_model=UnreceivedResponse)
async def unreceive_supplier_order(
    order_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Отмена оприходования — удаление FIFO-лотов, возврат статуса в draft."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await order_service.unreceive_order(
                conn, order_id=order_id, user_id=str(user["id"])
            )
