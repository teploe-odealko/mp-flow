from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.list_query import ListQuery, list_query_dep
from proxy.src.routes.admin.response_models import (
    FinanceItemResponse,
    FinanceListResponse,
    OkResponse,
)
from proxy.src.services.admin import finance_service
from pydantic import BaseModel, Field

router = APIRouter(tags=["Finance"])


class FinanceTransactionCreateRequest(BaseModel):
    happened_at: datetime | None = None
    kind: str = Field(pattern="^(income|expense)$")
    category: str = Field(min_length=1, max_length=80)
    subcategory: str | None = Field(default=None, max_length=80)
    amount_rub: Decimal = Field(gt=0)
    notes: str | None = None
    source: str = Field(default="manual", max_length=30)
    external_id: str | None = Field(default=None, max_length=120)
    related_entity_type: str | None = Field(default=None, max_length=40)
    related_entity_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class FinanceTransactionUpdateRequest(BaseModel):
    happened_at: datetime | None = None
    kind: str | None = Field(default=None, pattern="^(income|expense)$")
    category: str | None = Field(default=None, min_length=1, max_length=80)
    amount_rub: Decimal | None = Field(default=None, gt=0)
    notes: str | None = None


FINANCE_SORT_FIELDS = {"happened_at", "amount_rub"}


@router.get("/finance/transactions", response_model=FinanceListResponse)
async def list_finance_transactions(
    request: Request,
    lq: ListQuery = Depends(
        list_query_dep(
            allowed_sort=FINANCE_SORT_FIELDS,
            default_sort="happened_at:desc",
            default_limit=200,
            max_limit=1000,
        )
    ),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    category: str | None = Query(default=None),
    source: str | None = Query(default=None),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Список финансовых операций с фильтрами по дате, типу, категории, источнику."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await finance_service.list_transactions(
            conn,
            user_id=str(user["id"]),
            lq=lq,
            date_from=date_from,
            date_to=date_to,
            kind=kind,
            category=category,
            source=source,
        )


@router.post("/finance/transactions", response_model=FinanceItemResponse)
async def create_finance_transaction(
    payload: FinanceTransactionCreateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Создание финансовой операции (income/expense)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await finance_service.create_transaction(
            conn,
            user_id=str(user["id"]),
            happened_at=payload.happened_at,
            kind=payload.kind,
            category=payload.category,
            subcategory=payload.subcategory,
            amount_rub=payload.amount_rub,
            source=payload.source,
            external_id=payload.external_id,
            related_entity_type=payload.related_entity_type,
            related_entity_id=payload.related_entity_id,
            notes=payload.notes,
            payload=payload.payload,
        )


@router.put("/finance/transactions/{txn_id}", response_model=FinanceItemResponse)
async def update_finance_transaction(
    txn_id: str,
    body: FinanceTransactionUpdateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Обновление финансовой операции."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await finance_service.update_transaction(
            conn,
            user_id=str(user["id"]),
            txn_id=txn_id,
            happened_at=body.happened_at,
            kind=body.kind,
            category=body.category,
            amount_rub=body.amount_rub,
            notes=body.notes,
        )
    if not result:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return result


@router.delete("/finance/transactions/{txn_id}", response_model=OkResponse)
async def delete_finance_transaction(
    txn_id: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Удаление финансовой операции."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        deleted = await finance_service.delete_transaction(
            conn, user_id=str(user["id"]), txn_id=txn_id
        )
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"ok": True}
