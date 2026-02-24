from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=4, max_length=200)


class AdminCreateUserRequest(BaseModel):
    username: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=4, max_length=200)
    full_name: str | None = Field(default=None, max_length=255)
    is_admin: bool = False
    is_active: bool = True


class AdminUpdateUserRequest(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=4, max_length=200)
    is_admin: bool | None = None
    is_active: bool | None = None


class MasterCardCreateRequest(BaseModel):
    sku: str | None = Field(default=None, max_length=100)
    title: str = Field(min_length=1, max_length=500)
    description: str | None = None
    brand: str | None = Field(default=None, max_length=200)
    ozon_product_id: str | None = Field(default=None, max_length=100)
    ozon_offer_id: str | None = Field(default=None, max_length=150)
    status: str = Field(default="draft", max_length=30)
    attributes: dict[str, Any] = Field(default_factory=dict)


class MasterCardUpdateRequest(BaseModel):
    sku: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = None
    brand: str | None = Field(default=None, max_length=200)
    ozon_product_id: str | None = Field(default=None, max_length=100)
    ozon_offer_id: str | None = Field(default=None, max_length=150)
    status: str | None = Field(default=None, max_length=30)
    attributes: dict[str, Any] | None = None


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
    # Legacy fields — kept for backward compat; purchase_price_rub = sum of allocated shared costs
    purchase_price_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    packaging_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    logistics_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    customs_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)
    extra_cost_rub: Decimal = Field(default=Decimal("0.00"), ge=0)


class SharedCost(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    total_rub: Decimal = Field(ge=0)
    method: str = Field(pattern="^(by_cny_price|by_volume|by_weight|equal)$")


class ReceiveItemEntry(BaseModel):
    item_id: str
    received_qty: Decimal = Field(ge=0)


class ReceiveOrderRequest(BaseModel):
    items: list[ReceiveItemEntry] = Field(min_length=1)


class SupplierOrderCreateRequest(BaseModel):
    order_number: str | None = Field(default=None, max_length=60)
    supplier_name: str = Field(min_length=1, max_length=500)
    order_date: date | None = None
    expected_date: date | None = None
    notes: str | None = None
    shared_costs: list[SharedCost] = Field(default_factory=list)
    items: list[SupplierOrderItemCreate] = Field(min_length=1)


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


class OzonSyncRequest(BaseModel):
    date_from: date | None = None
    date_to: date | None = None
    client_id: str | None = None
    api_key: str | None = None
    limit: int = Field(default=100, ge=1, le=1000)
    max_pages: int = Field(default=20, ge=1, le=500)


class OzonCredentialsUpsertRequest(BaseModel):
    client_id: str = Field(min_length=1, max_length=100)
    api_key: str = Field(min_length=1, max_length=255)


class OzonProductsImportRequest(BaseModel):
    client_id: str | None = None
    api_key: str | None = None
    page_size: int = Field(default=100, ge=1, le=1000)
    max_pages: int = Field(default=20, ge=1, le=200)
    update_existing: bool = True
    fill_dimensions_from_ozon: bool = True


class OzonStocksRequest(BaseModel):
    client_id: str | None = None
    api_key: str | None = None


class OzonSupplySyncRequest(BaseModel):
    client_id: str | None = None
    api_key: str | None = None
    max_pages: int = Field(default=50, ge=1, le=200)


class OzonWarehouseStockSyncRequest(BaseModel):
    client_id: str | None = None
    api_key: str | None = None


class ReportPnlOzonRequest(BaseModel):
    date_from: str | None = None
    date_to: str | None = None


class AdminSettingsUpdateRequest(BaseModel):
    usn_rate: float | None = Field(default=None, ge=0, le=100)


class InitialBalanceItem(BaseModel):
    master_card_id: str
    quantity: Decimal = Field(gt=0)
    unit_cost_rub: Decimal = Field(ge=0)


class InitialBalanceRequest(BaseModel):
    items: list[InitialBalanceItem] = Field(min_length=1)


class Preview1688Request(BaseModel):
    url: str = Field(min_length=8, max_length=2000)


class Import1688SourceRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    scene: str | None = None
    optimize_title: bool | None = None
    overwrite_title: bool = False
    overwrite_dimensions: bool = False
    selected_sku_id: str | None = None
    selected_sku_price: float | None = None
