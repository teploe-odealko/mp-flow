"""Pydantic response models for Admin ERP API.

Used as `response_model=` on FastAPI route decorators to generate
typed OpenAPI response schemas in Scalar docs.

All serialized types use `str` because `record_to_dict()` converts
UUID → str, datetime → RFC 3339 str, Decimal → str.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

# ---------------------------------------------------------------------------
# Common
# ---------------------------------------------------------------------------


class OkResponse(BaseModel):
    ok: bool = True


class DeletedResponse(BaseModel):
    deleted: bool = True
    order_number: str | None = None


class UnreceivedResponse(BaseModel):
    unreceived: bool = True
    lots_deleted: int = 0


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class AdminUserView(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    username: str
    full_name: str | None = None
    is_admin: bool
    is_active: bool
    created_at: str
    updated_at: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    expires_in: int
    user: AdminUserView


class MeResponse(BaseModel):
    user: AdminUserView


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class UsersListResponse(BaseModel):
    items: list[AdminUserView]
    total: int


class UserItemResponse(BaseModel):
    item: AdminUserView


# ---------------------------------------------------------------------------
# Catalog (Cards)
# ---------------------------------------------------------------------------


class CardView(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    sku: str | None = None
    title: str
    description: str | None = None
    brand: str | None = None
    ozon_product_id: str | None = None
    ozon_offer_id: str | None = None
    status: str
    attributes: dict[str, Any] = {}
    warehouse_qty: str | None = None
    created_at: str
    updated_at: str


class CardsListResponse(BaseModel):
    items: list[CardView]
    total: int
    limit: int
    offset: int


class CardItemResponse(BaseModel):
    item: CardView


class LotView(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    master_card_id: str
    initial_qty: str
    remaining_qty: str
    unit_cost_rub: str
    received_at: str | None = None
    purchase_price_rub: str | None = None
    packaging_cost_rub: str | None = None
    logistics_cost_rub: str | None = None
    customs_cost_rub: str | None = None
    extra_cost_rub: str | None = None
    allocations: list[dict[str, Any]] | None = None


class CardDetailResponse(BaseModel):
    item: CardView
    lots: list[LotView] = []
    sales: list[dict[str, Any]] = []


class Preview1688Response(BaseModel):
    title: str | None = None
    item_id: str | None = None
    url: str | None = None
    supplier_name: str | None = None
    images: list[str] = []
    skus: list[dict[str, Any]] = []
    dimensions: dict[str, Any] = {}
    price_min: float | None = None
    price_max: float | None = None


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------


class OrderView(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    order_number: str
    supplier_name: str
    status: str
    order_date: str | None = None
    expected_date: str | None = None
    total_amount: str | None = None
    notes: str | None = None
    shared_costs: Any = None
    created_at: str
    updated_at: str


class OrdersListResponse(BaseModel):
    items: list[OrderView]
    total: int
    limit: int
    offset: int


class OrderDetailResponse(BaseModel):
    order: OrderView
    items: list[dict[str, Any]] = []


class ReceiveResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    order: OrderView
    lots_created: list[dict[str, Any]] = []
    purchase_amount_rub: float = 0


# ---------------------------------------------------------------------------
# Inventory
# ---------------------------------------------------------------------------


class InventoryItemView(BaseModel):
    model_config = ConfigDict(extra="allow")
    master_card_id: str
    title: str | None = None
    sku: str | None = None
    total_qty: str | None = None
    avg_unit_cost: str | None = None
    total_value: str | None = None


class InventoryOverviewResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    items: list[InventoryItemView] = []
    total: int = 0


class InitialBalanceResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    created_lots: int = 0
    items: list[dict[str, Any]] = []


class InventoryAdjustmentResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    ok: bool = True
    master_card_id: str | None = None
    new_qty: str | None = None


# ---------------------------------------------------------------------------
# Sales
# ---------------------------------------------------------------------------


class SalesListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    items: list[dict[str, Any]] = []
    total: int = 0
    limit: int = 50
    offset: int = 0


class SaleCreateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    sale_id: str | None = None
    items: list[dict[str, Any]] = []


# ---------------------------------------------------------------------------
# Finance
# ---------------------------------------------------------------------------


class FinanceTransactionView(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    kind: str
    category: str
    subcategory: str | None = None
    amount_rub: str
    happened_at: str
    notes: str | None = None
    source: str
    external_id: str | None = None
    created_at: str
    updated_at: str


class FinanceListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    items: list[FinanceTransactionView] = []
    total: int = 0
    limit: int = 200
    offset: int = 0


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


class DdsReportResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    date_from: str
    date_to: str
    income_items: list[dict[str, Any]] = []
    expense_items: list[dict[str, Any]] = []
    totals: dict[str, Any] = {}


class PnlReportResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    date_from: str
    date_to: str
    rows: list[dict[str, Any]] = []
    totals: dict[str, Any] = {}


class UeSkuItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    sku: int
    product_name: str = ""
    master_card_id: str | None = None
    orders_qty: int = 0
    returns_qty: int = 0
    revenue: float = 0
    commission: float = 0
    last_mile: float = 0
    fulfillment: float = 0
    cogs: float = 0
    profit: float = 0
    margin_pct: float = 0


class StockValuationItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    sku: int
    product_name: str = ""
    stock: int = 0
    total_purchased: int = 0
    price_ozon: float = 0
    cost_per_unit: float = 0
    stock_value_cost: float = 0
    stock_value_ozon: float = 0
    potential_profit: float = 0


class UnitEconomicsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    date_from: str
    date_to: str
    items: list[UeSkuItem] = []
    totals: dict[str, Any] = {}
    shared_costs: list[dict[str, Any]] = []
    shared_total: float = 0
    stock_valuation: dict[str, Any] = {}


class PnlOzonIncomeView(BaseModel):
    model_config = ConfigDict(extra="allow")
    net_income: float = 0
    total_sales: float = 0
    revenue: float = 0
    returns_total: float = 0


class PnlOzonExpensesView(BaseModel):
    model_config = ConfigDict(extra="allow")
    commission: float = 0
    logistics: float = 0
    fbo: float = 0
    acquiring: float = 0
    marketing: float = 0
    returns: float = 0
    other: float = 0
    total: float = 0


class PnlOzonResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    date_from: str
    date_to: str
    income: PnlOzonIncomeView = PnlOzonIncomeView()
    ozon_expenses: PnlOzonExpensesView = PnlOzonExpensesView()
    services_detail: list[dict[str, Any]] = []
    cogs: float = 0
    manual_income: float = 0
    manual_income_detail: list[dict[str, Any]] = []
    manual_expense: float = 0
    manual_expense_detail: list[dict[str, Any]] = []
    tax_usn: float = 0
    usn_rate: float = 7.0
    taxable_revenue: float = 0
    net_profit: float = 0
    margin_pct: float = 0


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


class SettingsResponse(BaseModel):
    usn_rate: float = 7.0


# ---------------------------------------------------------------------------
# Integrations
# ---------------------------------------------------------------------------


class OzonIntegrationResponse(BaseModel):
    has_credentials: bool
    client_id_masked: str | None = None
    api_key_masked: str | None = None


class OzonAccountItemResponse(BaseModel):
    item: dict[str, Any]


# ---------------------------------------------------------------------------
# Ozon Sync
# ---------------------------------------------------------------------------


class SyncFreshnessResponse(BaseModel):
    sync_types: dict[str, str | None]


class SyncResultResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    synced: int | None = None
    created: int | None = None
    updated: int | None = None
    skipped: int | None = None
    errors: int | None = None


# ---------------------------------------------------------------------------
# Logistics
# ---------------------------------------------------------------------------


class LogisticsMatrixResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    items: list[dict[str, Any]] = []
    total: int = 0
    needs_initial_balance: bool = False


class WriteOffResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    ok: bool = True
    deducted: int | None = None
    expense_created: bool | None = None


class AcceptanceUpdateResponse(BaseModel):
    item_id: str
    quantity_accepted: int
    quantity_rejected: int


class SupplyItemView(BaseModel):
    model_config = ConfigDict(extra="allow")
    offer_id: str | None = None
    product_name: str | None = None
    card_sku: str | None = None
    master_card_id: str | None = None
    planned: int = 0
    accepted: int = 0
    rejected: int = 0


class SupplyView(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    supply_order_id: str | None = None
    supply_number: str | None = None
    status: str | None = None
    warehouse_name: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    total_planned: int = 0
    total_accepted: int = 0
    total_rejected: int = 0
    has_discrepancy: bool = False
    items: list[SupplyItemView] = []


class SuppliesListResponse(BaseModel):
    supplies: list[SupplyView] = []
    total: int = 0


class SkuDetailLossView(BaseModel):
    model_config = ConfigDict(extra="allow")
    total_qty: int = 0
    total_cost_rub: float = 0
    details: list[dict[str, Any]] = []


class SkuDetailResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    card: dict[str, Any]
    supplier_orders: list[dict[str, Any]] = []
    ozon_supplies: list[dict[str, Any]] = []
    stock_snapshots: list[dict[str, Any]] = []
    inventory_lots: list[dict[str, Any]] = []
    recent_sales: list[dict[str, Any]] = []
    losses: SkuDetailLossView = SkuDetailLossView()


# ---------------------------------------------------------------------------
# Demand
# ---------------------------------------------------------------------------


class DemandPlanResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


class DemandPlansListResponse(BaseModel):
    plans: list[dict[str, Any]] = []


class DemandPlanItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


class DemandParamsResponse(BaseModel):
    params: list[dict[str, Any]] = []


class DemandParamItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


class ClusterTargetsResponse(BaseModel):
    targets: list[dict[str, Any]] = []


class ClusterTargetItemResponse(BaseModel):
    model_config = ConfigDict(extra="allow")


class ClusterStockResponse(BaseModel):
    items: list[dict[str, Any]] = []
    total: int = 0
    synced_at: str | None = None


# ---------------------------------------------------------------------------
# API Keys
# ---------------------------------------------------------------------------


class ApiKeyView(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    key_prefix: str
    is_active: bool = True
    last_used_at: str | None = None
    created_at: str
    updated_at: str


class ApiKeysListResponse(BaseModel):
    items: list[ApiKeyView] = []


class ApiKeyCreateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    key_prefix: str
    raw_key: str
    created_at: str
