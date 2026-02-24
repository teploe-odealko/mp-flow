from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.list_query import ListQuery, list_query_dep
from proxy.src.routes.admin.response_models import SaleCreateResponse, SalesListResponse
from proxy.src.services.admin import sales_service
from pydantic import BaseModel, Field

router = APIRouter(tags=["Sales"])


class SaleItemCreate(BaseModel):
    master_card_id: str
    quantity: Decimal = Field(gt=0)
    unit_sale_price_rub: Decimal = Field(ge=0)
    fee_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    extra_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    source_offer_id: str | None = Field(default=None, max_length=150)


class SaleCreateRequest(BaseModel):
    marketplace: str = Field(default="ozon", max_length=40)
    external_order_id: str | None = Field(default=None, max_length=120)
    sold_at: datetime | None = None
    status: str = Field(default="completed", max_length=30)
    items: list[SaleItemCreate] = Field(min_length=1)
    raw_payload: dict[str, Any] = Field(default_factory=dict)


SALES_SORT_FIELDS = {"sold_at", "created_at"}


@router.get("/sales", response_model=SalesListResponse)
async def list_sales_orders(
    request: Request,
    lq: ListQuery = Depends(
        list_query_dep(allowed_sort=SALES_SORT_FIELDS, default_sort="sold_at:desc")
    ),
    marketplace: str | None = Query(default=None),
    status: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Список продаж с поиском, фильтрами и сортировкой."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await sales_service.list_sales(
            conn,
            user_id=str(user["id"]),
            lq=lq,
            marketplace=marketplace,
            status=status,
        )


@router.post("/sales", response_model=SaleCreateResponse)
async def create_sale(
    payload: SaleCreateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Ручное создание продажи с FIFO-списанием себестоимости."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await sales_service.create_sale(
                conn,
                user_id=str(user["id"]),
                marketplace=payload.marketplace,
                external_order_id=payload.external_order_id,
                sold_at=payload.sold_at,
                status=payload.status,
                items=[item.model_dump(mode="json") for item in payload.items],
                raw_payload=payload.raw_payload,
                source="manual",
                record_finance_transactions=True,
            )
