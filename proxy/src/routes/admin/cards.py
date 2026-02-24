from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.list_query import ListQuery, list_query_dep
from proxy.src.routes.admin.response_models import (
    CardDetailResponse,
    CardItemResponse,
    CardsListResponse,
    Preview1688Response,
)
from proxy.src.services.admin import card_service
from pydantic import BaseModel, Field

router = APIRouter(tags=["Catalog"])


class CardCreateRequest(BaseModel):
    sku: str | None = Field(default=None, max_length=100)
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    brand: str | None = Field(default=None, max_length=200)
    ozon_product_id: str | None = Field(default=None, max_length=100)
    ozon_offer_id: str | None = Field(default=None, max_length=150)
    status: str = Field(default="draft", max_length=30)
    attributes: dict[str, Any] = Field(default_factory=dict)


class CardUpdateRequest(BaseModel):
    sku: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    brand: str | None = Field(default=None, max_length=200)
    ozon_product_id: str | None = Field(default=None, max_length=100)
    ozon_offer_id: str | None = Field(default=None, max_length=150)
    status: str | None = Field(default=None, max_length=30)
    attributes: dict[str, Any] | None = None


class Preview1688Request(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


class Import1688Request(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    scene: str | None = None
    optimize_title: bool | None = None
    overwrite_title: bool = False
    overwrite_dimensions: bool = False
    selected_sku_id: str | None = None
    selected_sku_price: float | None = None


CARDS_SORT_FIELDS = {"created_at", "updated_at", "title", "sku"}


@router.get("/master-cards", response_model=CardsListResponse)
async def list_master_cards(
    request: Request,
    lq: ListQuery = Depends(
        list_query_dep(allowed_sort=CARDS_SORT_FIELDS, default_sort="updated_at:desc")
    ),
    include_archived: bool = Query(default=False),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Список карточек товаров с поиском по названию, SKU, бренду."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await card_service.list_cards(
            conn,
            user_id=str(user["id"]),
            lq=lq,
            include_archived=include_archived,
        )


@router.post("/master-cards", response_model=CardItemResponse)
async def create_master_card(
    payload: CardCreateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Создание новой карточки товара."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await card_service.create_card(
            conn,
            user_id=str(user["id"]),
            sku=payload.sku,
            title=payload.title,
            description=payload.description,
            brand=payload.brand,
            ozon_product_id=payload.ozon_product_id,
            ozon_offer_id=payload.ozon_offer_id,
            status=payload.status,
            attributes=payload.attributes,
        )


@router.get("/master-cards/{card_id}", response_model=CardDetailResponse)
async def get_master_card(
    card_id: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Детальная информация о карточке: атрибуты, FIFO-лоты, источники."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await card_service.get_card_detail(conn, card_id=card_id, user_id=str(user["id"]))


@router.patch("/master-cards/{card_id}", response_model=CardItemResponse)
async def update_master_card(
    card_id: str,
    payload: CardUpdateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Обновление полей карточки (partial update)."""
    fields: dict[str, Any] = {}
    for field_name in (
        "sku",
        "title",
        "description",
        "brand",
        "ozon_product_id",
        "ozon_offer_id",
        "status",
    ):
        value = getattr(payload, field_name)
        if value is not None:
            fields[field_name] = value
    if payload.attributes is not None:
        fields["attributes"] = payload.attributes

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await card_service.update_card(
            conn,
            card_id=card_id,
            user_id=str(user["id"]),
            fields=fields,
        )


@router.post("/master-cards/sources/1688/preview", response_model=Preview1688Response)
async def preview_1688_source(
    payload: Preview1688Request,
    _: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Предпросмотр товара с 1688.com по URL (без сохранения)."""
    return await card_service.preview_1688(payload.url)


@router.post("/master-cards/{card_id}/sources/1688/import", response_model=CardItemResponse)
async def import_1688_source(
    card_id: str,
    payload: Import1688Request,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Импорт данных с 1688.com в существующую карточку."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await card_service.import_1688(
            conn,
            card_id=card_id,
            user_id=str(user["id"]),
            url=payload.url,
            scene=payload.scene,
            optimize_title=payload.optimize_title,
            overwrite_title=payload.overwrite_title,
            overwrite_dimensions=payload.overwrite_dimensions,
            selected_sku_id=payload.selected_sku_id,
            selected_sku_price=payload.selected_sku_price,
        )
