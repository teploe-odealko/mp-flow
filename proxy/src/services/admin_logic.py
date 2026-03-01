"""
Business logic helpers for admin ERP module.

Contains pure functions for:
- FIFO cost allocation
- money/quantity normalization
- DDS and PnL report aggregation
- resilient parsing of Ozon API payloads
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from hashlib import sha256
from typing import Any, Iterable

MONEY_QUANT = Decimal("0.01")
QTY_QUANT = Decimal("0.001")
EPSILON = Decimal("0.000001")


def to_money(value: Any) -> Decimal:
    """Normalize a numeric-like value to money with 2 digits."""
    if isinstance(value, Decimal):
        return value.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    try:
        return Decimal(str(value or 0)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def to_qty(value: Any) -> Decimal:
    """Normalize quantity to 3 decimal digits."""
    if isinstance(value, Decimal):
        return value.quantize(QTY_QUANT, rounding=ROUND_HALF_UP)
    try:
        return Decimal(str(value or 0)).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.000")


@dataclass(slots=True)
class FifoLot:
    """Inventory lot used for FIFO allocation."""

    lot_id: str
    remaining_qty: Decimal
    unit_cost_rub: Decimal
    received_at: datetime | None = None


@dataclass(slots=True)
class FifoAllocation:
    """Concrete sale allocation against a lot."""

    lot_id: str
    quantity: Decimal
    unit_cost_rub: Decimal
    total_cost_rub: Decimal


class InsufficientInventoryError(ValueError):
    """Raised when FIFO allocation cannot satisfy requested quantity."""

    def __init__(self, requested_qty: Decimal, allocated_qty: Decimal):
        self.requested_qty = requested_qty
        self.allocated_qty = allocated_qty
        self.shortage_qty = (requested_qty - allocated_qty).quantize(
            QTY_QUANT, rounding=ROUND_HALF_UP
        )
        super().__init__(
            "Insufficient inventory: requested={requested} allocated={allocated} shortage={shortage}".format(
                requested=requested_qty,
                allocated=allocated_qty,
                shortage=self.shortage_qty,
            )
        )


def allocate_fifo(lots: Iterable[FifoLot], requested_qty: Decimal) -> list[FifoAllocation]:
    """
    Allocate quantity from lots using FIFO order.

    Args:
        lots: available lots sorted (or unsorted)
        requested_qty: quantity to allocate

    Returns:
        Allocations list.

    Raises:
        InsufficientInventoryError: if stock is not enough.
    """
    need = to_qty(requested_qty)
    if need <= 0:
        return []

    sorted_lots = sorted(
        lots,
        key=lambda lot: (
            lot.received_at or datetime.min,
            lot.lot_id,
        ),
    )

    allocations: list[FifoAllocation] = []
    allocated = Decimal("0.000")
    for lot in sorted_lots:
        remaining = to_qty(lot.remaining_qty)
        if remaining <= EPSILON:
            continue
        if need <= EPSILON:
            break

        take = min(remaining, need).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)
        if take <= EPSILON:
            continue

        unit_cost = to_money(lot.unit_cost_rub)
        total_cost = to_money(take * unit_cost)
        allocations.append(
            FifoAllocation(
                lot_id=lot.lot_id,
                quantity=take,
                unit_cost_rub=unit_cost,
                total_cost_rub=total_cost,
            )
        )
        allocated += take
        need = (need - take).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)

    if need > EPSILON:
        raise InsufficientInventoryError(
            requested_qty=to_qty(requested_qty), allocated_qty=allocated
        )

    return allocations


def calculate_purchase_unit_cost(
    *,
    quantity: Any,
    purchase_price_rub: Any,
    packaging_cost_rub: Any = 0,
    logistics_cost_rub: Any = 0,
    customs_cost_rub: Any = 0,
    extra_cost_rub: Any = 0,
) -> Decimal:
    """Compute unit cost for supplier-order line."""
    qty = to_qty(quantity)
    if qty <= 0:
        raise ValueError("quantity must be > 0")

    total = (
        to_money(purchase_price_rub)
        + to_money(packaging_cost_rub)
        + to_money(logistics_cost_rub)
        + to_money(customs_cost_rub)
        + to_money(extra_cost_rub)
    )
    return to_money(total / qty)


def calculate_sale_metrics(
    *,
    quantity: Any,
    unit_sale_price_rub: Any,
    fee_rub: Any = 0,
    extra_cost_rub: Any = 0,
    allocations: Iterable[FifoAllocation],
) -> dict[str, Decimal]:
    """Calculate revenue, COGS and profit for a sale line."""
    qty = to_qty(quantity)
    revenue = to_money(qty * to_money(unit_sale_price_rub))
    fee = to_money(fee_rub)
    extra = to_money(extra_cost_rub)
    cogs = to_money(sum((a.total_cost_rub for a in allocations), start=Decimal("0.00")))
    gross_profit = to_money(revenue - cogs - fee - extra)
    return {
        "revenue_rub": revenue,
        "fee_rub": fee,
        "extra_cost_rub": extra,
        "cogs_rub": cogs,
        "gross_profit_rub": gross_profit,
    }


def _date_key(value: Any, group_by: str) -> str:
    if isinstance(value, datetime):
        dt_value = value
    elif isinstance(value, date):
        dt_value = datetime.combine(value, datetime.min.time())
    elif isinstance(value, str):
        try:
            dt_value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            dt_value = datetime.utcnow()
    else:
        dt_value = datetime.utcnow()

    if group_by == "month":
        return dt_value.strftime("%Y-%m")
    return dt_value.date().isoformat()


def build_dds_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Build cash flow (DDS) report."""
    per_day: dict[str, dict[str, Decimal]] = {}
    by_category: dict[str, dict[str, Decimal]] = {}

    total_income = Decimal("0.00")
    total_expense = Decimal("0.00")

    for row in rows:
        key = _date_key(row.get("happened_at"), group_by="day")
        kind = str(row.get("kind") or "").lower()
        category = str(row.get("category") or "other")
        amount = to_money(row.get("amount_rub"))

        per_day.setdefault(key, {"income": Decimal("0.00"), "expense": Decimal("0.00")})
        by_category.setdefault(category, {"income": Decimal("0.00"), "expense": Decimal("0.00")})

        if kind == "income":
            per_day[key]["income"] += amount
            by_category[category]["income"] += amount
            total_income += amount
        else:
            per_day[key]["expense"] += amount
            by_category[category]["expense"] += amount
            total_expense += amount

    rows_out = []
    for key in sorted(per_day.keys()):
        income = to_money(per_day[key]["income"])
        expense = to_money(per_day[key]["expense"])
        rows_out.append(
            {
                "date": key,
                "income_rub": income,
                "expense_rub": expense,
                "net_cashflow_rub": to_money(income - expense),
            }
        )

    categories_out = []
    for category, amounts in sorted(by_category.items(), key=lambda item: item[0]):
        income = to_money(amounts["income"])
        expense = to_money(amounts["expense"])
        categories_out.append(
            {
                "category": category,
                "income_rub": income,
                "expense_rub": expense,
                "net_rub": to_money(income - expense),
            }
        )

    return {
        "rows": rows_out,
        "by_category": categories_out,
        "totals": {
            "income_rub": to_money(total_income),
            "expense_rub": to_money(total_expense),
            "net_cashflow_rub": to_money(total_income - total_expense),
        },
    }


def build_pnl_report(
    *,
    sales_rows: list[dict[str, Any]],
    operating_expense_rows: list[dict[str, Any]],
    group_by: str = "day",
) -> dict[str, Any]:
    """Build PnL report grouped by day/month."""
    if group_by not in {"day", "month"}:
        raise ValueError("group_by must be one of: day, month")

    grouped: dict[str, dict[str, Decimal]] = {}
    for row in sales_rows:
        key = _date_key(row.get("sold_at"), group_by=group_by)
        metric = grouped.setdefault(
            key,
            {
                "revenue_rub": Decimal("0.00"),
                "cogs_rub": Decimal("0.00"),
                "fees_rub": Decimal("0.00"),
                "extra_cost_rub": Decimal("0.00"),
                "operating_expenses_rub": Decimal("0.00"),
            },
        )
        metric["revenue_rub"] += to_money(row.get("revenue_rub"))
        metric["cogs_rub"] += to_money(row.get("cogs_rub"))
        metric["fees_rub"] += to_money(row.get("fee_rub"))
        metric["extra_cost_rub"] += to_money(row.get("extra_cost_rub"))

    for row in operating_expense_rows:
        key = _date_key(row.get("happened_at"), group_by=group_by)
        metric = grouped.setdefault(
            key,
            {
                "revenue_rub": Decimal("0.00"),
                "cogs_rub": Decimal("0.00"),
                "fees_rub": Decimal("0.00"),
                "extra_cost_rub": Decimal("0.00"),
                "operating_expenses_rub": Decimal("0.00"),
            },
        )
        metric["operating_expenses_rub"] += to_money(row.get("amount_rub"))

    output_rows = []
    totals = {
        "revenue_rub": Decimal("0.00"),
        "cogs_rub": Decimal("0.00"),
        "fees_rub": Decimal("0.00"),
        "extra_cost_rub": Decimal("0.00"),
        "gross_profit_rub": Decimal("0.00"),
        "operating_expenses_rub": Decimal("0.00"),
        "net_profit_rub": Decimal("0.00"),
    }

    for key in sorted(grouped.keys()):
        metric = grouped[key]
        gross_profit = to_money(
            metric["revenue_rub"]
            - metric["cogs_rub"]
            - metric["fees_rub"]
            - metric["extra_cost_rub"]
        )
        net_profit = to_money(gross_profit - metric["operating_expenses_rub"])
        row = {
            "period": key,
            "revenue_rub": to_money(metric["revenue_rub"]),
            "cogs_rub": to_money(metric["cogs_rub"]),
            "fees_rub": to_money(metric["fees_rub"]),
            "extra_cost_rub": to_money(metric["extra_cost_rub"]),
            "gross_profit_rub": gross_profit,
            "operating_expenses_rub": to_money(metric["operating_expenses_rub"]),
            "net_profit_rub": net_profit,
        }
        output_rows.append(row)
        for field in totals:
            totals[field] += row[field]

    return {
        "group_by": group_by,
        "rows": output_rows,
        "totals": {key: to_money(value) for key, value in totals.items()},
    }


def classify_ozon_operation(operation_type: str) -> tuple[str, str]:
    """
    Map Ozon operation type to (kind, category).
    kind: income | expense
    """
    normalized = (operation_type or "").strip().lower()
    if not normalized:
        return "expense", "ozon_other"

    sale_markers = ("sale", "продаж", "accrual", "доначисление")
    fee_markers = ("commission", "комисс", "логист", "доставка", "услуг", "service")
    refund_markers = ("refund", "возврат", "compensation", "коррект")

    if any(marker in normalized for marker in sale_markers):
        return "income", "ozon_sales"
    if any(marker in normalized for marker in fee_markers):
        return "expense", "ozon_fees"
    if any(marker in normalized for marker in refund_markers):
        return "expense", "ozon_refunds"
    return "expense", "ozon_other"


def _safe_external_id(prefix: str, obj: dict[str, Any]) -> str:
    serialized = str(sorted(obj.items()))
    return f"{prefix}_{sha256(serialized.encode('utf-8')).hexdigest()[:20]}"


def _extract_amount(item: dict[str, Any]) -> Decimal:
    candidates = [
        item.get("amount"),
        item.get("amount_rub"),
        item.get("accruals_for_sale"),
        item.get("sale_commission"),
        item.get("services_amount"),
        item.get("value"),
    ]
    for candidate in candidates:
        try:
            amount = Decimal(str(candidate))
            if amount != 0:
                return to_money(amount)
        except (InvalidOperation, ValueError, TypeError):
            continue
    return Decimal("0.00")


def parse_ozon_finance_transactions(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Parse Ozon finance transaction API response into normalized rows.
    """
    result = payload.get("result") if isinstance(payload, dict) else None
    items = []
    if isinstance(result, dict):
        items = result.get("operations") or result.get("items") or []
    if not items and isinstance(payload, dict):
        items = payload.get("operations") or payload.get("items") or []
    if not isinstance(items, list):
        return []

    parsed: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        operation_type = str(
            item.get("operation_type_name")
            or item.get("operation_type")
            or item.get("type")
            or "unknown"
        )
        raw_amount = _extract_amount(item)
        if raw_amount == 0:
            continue

        happened_at = (
            item.get("operation_date")
            or item.get("date")
            or item.get("created_at")
            or item.get("moment")
            or datetime.utcnow().isoformat()
        )
        external_id = str(
            item.get("operation_id")
            or item.get("id")
            or item.get("transaction_id")
            or _safe_external_id("ozon_fin", item)
        )

        inferred_kind, inferred_category = classify_ozon_operation(operation_type)
        kind = inferred_kind
        amount = to_money(abs(raw_amount))
        if raw_amount < 0:
            kind = "expense"
        elif raw_amount > 0 and inferred_kind != "income":
            # Positive values in unknown/fee categories still treated as income.
            kind = "income"

        parsed.append(
            {
                "external_id": external_id,
                "happened_at": happened_at,
                "kind": kind,
                "category": inferred_category,
                "subcategory": operation_type,
                "amount_rub": amount,
                "notes": str(item.get("posting_number") or item.get("description") or ""),
                "payload": item,
            }
        )
    return parsed


# ---------------------------------------------------------------------------
# Ozon Unit Economics — service type mapping & per-operation parser
# ---------------------------------------------------------------------------

OZON_SERVICE_CATEGORY_MAP: dict[str, str] = {
    # Last mile
    "MarketplaceServiceItemDelivToCustomer": "last_mile",
    "MarketplaceServiceItemDeliveryKGT": "last_mile",
    # Pipeline / magistral
    "MarketplaceServiceItemDirectFlowTrans": "pipeline",
    "MarketplaceServiceItemDirectFlowLogistic": "pipeline",
    # Fulfillment
    "MarketplaceServiceItemFulfillment": "fulfillment",
    # Dropoff (order processing)
    "MarketplaceServiceItemDropoffFF": "dropoff",
    "MarketplaceServiceItemDropoffPVZ": "dropoff",
    "MarketplaceServiceItemDropoffSC": "dropoff",
    "MarketplaceServiceItemDropoffPPZ": "dropoff",
    # Acquiring
    "MarketplaceRedistributionOfAcquiringOperation": "acquiring",
    # Return logistics
    "MarketplaceServiceItemReturnFlowTrans": "return_logistics",
    "MarketplaceServiceItemReturnFlowLogistic": "return_logistics",
    # Return processing
    "MarketplaceServiceItemReturnAfterDelivToCustomer": "return_processing",
    "MarketplaceServiceItemReturnNotDelivToCustomer": "return_processing",
    "MarketplaceServiceItemReturnPartGoodsCustomer": "return_processing",
    "MarketplaceServiceItemReturnFromStock": "return_processing",
    "MarketplaceServiceItemRedistributionReturnsPVZ": "return_processing",
    "MarketplaceNotDeliveredCostItem": "return_processing",
    "TransactionOperationServiceNotDelivered": "return_processing",
    "MarketplaceDeliveryCostItem": "return_processing",
    # Marketing & promotions
    "MarketplaceMarketingActionCostItem": "marketing",
    "MarketplaceSaleReviewsItem": "marketing",
    "MarketplaceServicePremiumCashbackIndividualPoints": "marketing",
    "MarketplaceServicePremiumPromotion": "marketing",
    # Installment
    "MarketplaceServiceItemInstallment": "installment",
    # Storage (shared, but map for completeness)
    "OperationMarketplaceServiceStorage": "other_services",
    # Cross-docking
    "ItemAdvertisementForSupplierLogistic": "other_services",
    "ItemAdvertisementForSupplierLogisticSeller": "other_services",
    # Marking
    "MarketplaceServiceItemMarkingItems": "other_services",
    # Other
    "MarketplaceServiceItemFlexiblePaymentSchedule": "other_services",
    "ItemAgentServiceStarsMembership": "other_services",
    "MarketplaceServiceItemPickup": "other_services",
    "OperationMarketplaceWithHoldingForUndeliverableGoods": "other_services",
    "OperationMarketplaceAgencyFeeAggregator3PLGlobal": "other_services",
    "MarketplaceReturnStorageServiceAtThePickupPointFbsItem": "other_services",
    "MarketplaceReturnStorageServiceInTheWarehouseFbsItem": "other_services",
}

_COST_COLUMNS = (
    "last_mile",
    "pipeline",
    "fulfillment",
    "dropoff",
    "acquiring",
    "return_logistics",
    "return_processing",
    "marketing",
    "installment",
    "other_services",
)


def parse_ozon_operation_economics(
    operation: dict[str, Any],
    user_id: int,
) -> list[dict[str, Any]]:
    """
    Parse a single Ozon finance transaction operation into per-SKU economics rows.

    Returns a list of dicts (one per SKU in the operation).
    Operations with no items[] (shared costs) get sku=0 and operation_type_name as product_name.
    Splits top-level amounts and services equally across items when multiple items exist.
    """
    # Common fields (needed for both per-SKU and shared rows)
    operation_id = operation.get("operation_id") or 0
    operation_date = (
        operation.get("operation_date")
        or operation.get("date")
        or datetime.now(timezone.utc).isoformat()
    )
    operation_type = str(
        operation.get("operation_type") or operation.get("operation_type_name") or ""
    )
    operation_type_name = str(operation.get("operation_type_name") or operation_type)
    finance_type = str(operation.get("type") or "")
    posting = operation.get("posting") or {}
    posting_number = str(posting.get("posting_number") or "")
    delivery_schema = str(posting.get("delivery_schema") or "")
    services_raw = operation.get("services") or []

    # Parse services and classify into cost categories
    cost_totals: dict[str, Decimal] = {col: Decimal("0") for col in _COST_COLUMNS}
    for svc in services_raw:
        if not isinstance(svc, dict):
            continue
        svc_name = str(svc.get("name") or "")
        svc_price = Decimal(str(svc.get("price") or 0))
        category = OZON_SERVICE_CATEGORY_MAP.get(svc_name, "other_services")
        cost_totals[category] += svc_price

    items = operation.get("items") or []
    if not isinstance(items, list):
        items = []

    # Count quantity per SKU (not just dedup)
    sku_counts: dict[int, int] = {}
    sku_names: dict[int, str] = {}
    total_items = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_sku = item.get("sku")
        if not raw_sku:
            continue
        try:
            sku_val = int(raw_sku)
        except (ValueError, TypeError):
            continue
        sku_counts[sku_val] = sku_counts.get(sku_val, 0) + 1
        sku_names[sku_val] = str(item.get("name") or "")
        total_items += 1
    skus = list(sku_counts.keys())

    # Shared cost (no items) — store with sku=0
    if not skus:
        amount = to_money(Decimal(str(operation.get("amount") or 0)))
        if amount == 0 and all(v == 0 for v in cost_totals.values()):
            return []
        per_item_costs = {col: to_money(val) for col, val in cost_totals.items()}
        return [
            {
                "user_id": user_id,
                "operation_id": int(operation_id),
                "operation_date": operation_date,
                "operation_type": operation_type,
                "posting_number": posting_number,
                "delivery_schema": delivery_schema,
                "sku": 0,
                "product_name": operation_type_name,
                "quantity": 0,
                "revenue": Decimal("0"),
                "sale_commission": Decimal("0"),
                "total_amount": amount,
                **per_item_costs,
                "services_raw": services_raw,
                "finance_type": finance_type,
            }
        ]

    if total_items == 0:
        total_items = len(skus) or 1

    # Top-level totals (to be split proportionally by quantity)
    revenue_total = Decimal(str(operation.get("accruals_for_sale") or 0))
    commission_total = Decimal(str(operation.get("sale_commission") or 0))
    amount_total = Decimal(str(operation.get("amount") or 0))

    rows = []
    for sku in skus:
        qty = sku_counts[sku]
        share = Decimal(qty) / Decimal(total_items)
        per_sku_costs = {col: to_money(val * share) for col, val in cost_totals.items()}
        row = {
            "user_id": user_id,
            "operation_id": int(operation_id),
            "operation_date": operation_date,
            "operation_type": operation_type,
            "posting_number": posting_number,
            "delivery_schema": delivery_schema,
            "sku": sku,
            "product_name": sku_names.get(sku, ""),
            "quantity": qty,
            "revenue": to_money(revenue_total * share),
            "sale_commission": to_money(commission_total * share),
            "total_amount": to_money(amount_total * share),
            **per_sku_costs,
            "services_raw": services_raw,
            "finance_type": finance_type,
        }
        rows.append(row)

    return rows



def _to_float_or_none(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(str(value).strip())
        if number <= 0:
            return None
        return round(number, 3)
    except (ValueError, TypeError):
        return None


def _to_length_cm(value: Any, unit: Any) -> float | None:
    raw = _to_float_or_none(value)
    if raw is None:
        return None
    unit_s = str(unit or "").strip().lower()
    if unit_s == "mm":
        return round(raw / 10.0, 3)
    if unit_s == "m":
        return round(raw * 100.0, 3)
    # Default assume centimeters.
    return raw


def _to_weight_kg(value: Any, unit: Any) -> float | None:
    raw = _to_float_or_none(value)
    if raw is None:
        return None
    unit_s = str(unit or "").strip().lower()
    if unit_s == "g":
        return round(raw / 1000.0, 3)
    # Default assume kilograms.
    return raw


def parse_ozon_products(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Parse Ozon products list payload (v2/v3 variations) into normalized records.
    """
    result = payload.get("result") if isinstance(payload, dict) else None
    items: list[Any] = []
    if isinstance(result, dict):
        candidate_items = result.get("items") or result.get("products") or result.get("result")
        if isinstance(candidate_items, list):
            items = candidate_items
    elif isinstance(result, list):
        items = result
    if not items and isinstance(payload, dict):
        candidate_items = payload.get("items") or payload.get("products")
        if isinstance(candidate_items, list):
            items = candidate_items
    if not isinstance(items, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        offer_id = str(
            item.get("offer_id") or item.get("offerId") or item.get("offer") or ""
        ).strip()
        product_id = str(
            item.get("product_id")
            or item.get("productId")
            or item.get("id")
            or item.get("productID")
            or ""
        ).strip()
        sku = str(item.get("sku") or item.get("sku_id") or offer_id or product_id or "").strip()
        title = str(
            item.get("name")
            or item.get("title")
            or item.get("product_name")
            or item.get("offer_name")
            or ""
        ).strip()
        # Fallback: extract name from attributes array (attribute_id 4191 = Название)
        if not title or title.startswith("Товар ") or title.lower().startswith("product "):
            attrs_list = item.get("attributes")
            if isinstance(attrs_list, list):
                for attr in attrs_list:
                    if isinstance(attr, dict) and attr.get("attribute_id") in (4191, 9048):
                        values = attr.get("values") or []
                        if isinstance(values, list) and values:
                            attr_name = str(values[0].get("value") or "").strip()
                            if attr_name:
                                title = attr_name
                                break
        if not title:
            title = f"Товар {offer_id or product_id or 'without-id'}"

        brand_value = item.get("brand")
        if isinstance(brand_value, dict):
            brand = str(brand_value.get("name") or brand_value.get("title") or "").strip() or None
        else:
            brand = str(brand_value).strip() if brand_value else None

        images: list[str] = []
        image_list = item.get("images") or item.get("image_urls") or item.get("pictures")
        if isinstance(image_list, list):
            images.extend([str(image).strip() for image in image_list if image])
        main_image = item.get("primary_image") or item.get("image") or item.get("main_image")
        if main_image:
            image_str = str(main_image).strip()
            if image_str and image_str not in images:
                images.insert(0, image_str)

        dimensions = item.get("dimensions") if isinstance(item.get("dimensions"), dict) else {}
        dimension_unit = (
            item.get("dimension_unit") or dimensions.get("dimension_unit") or dimensions.get("unit")
        )
        weight_unit = (
            item.get("weight_unit") or dimensions.get("weight_unit") or dimensions.get("weightUnit")
        )
        # Ozon returns package dimensions/weight used for logistics.
        normalized_dimensions = {
            "package_length_cm": _to_length_cm(
                dimensions.get("length") or item.get("length") or item.get("depth"),
                dimension_unit,
            ),
            "package_width_cm": _to_length_cm(
                dimensions.get("width") or item.get("width"), dimension_unit
            ),
            "package_height_cm": _to_length_cm(
                dimensions.get("height") or item.get("height"), dimension_unit
            ),
            "package_weight_kg": _to_weight_kg(
                dimensions.get("weight")
                or item.get("weight")
                or item.get("weight_kg")
                or item.get("weightKg")
                or item.get("weight_grams")
                or item.get("weightGrams"),
                weight_unit,
            ),
        }
        normalized_dimensions = {k: v for k, v in normalized_dimensions.items() if v is not None}

        normalized.append(
            {
                "product_id": product_id or None,
                "offer_id": offer_id or None,
                "sku": sku or None,
                "title": title,
                "description": (
                    str(item.get("description")).strip()
                    if item.get("description") is not None
                    else None
                ),
                "brand": brand,
                "images": images,
                "dimensions": normalized_dimensions,
                "raw": item,
            }
        )
    return normalized


def extract_ozon_products_cursor(payload: dict[str, Any]) -> str | None:
    """Extract pagination cursor (last_id) from Ozon product list payload."""
    if not isinstance(payload, dict):
        return None
    result = payload.get("result")
    if isinstance(result, dict):
        for key in ("last_id", "lastId", "cursor"):
            value = result.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
    for key in ("last_id", "lastId", "cursor"):
        value = payload.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def parse_tmapi_1688_item(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Parse TMAPI 1688 response to a normalized supplier snapshot.
    Keeps parser tolerant because response shape varies by endpoint/version.
    """
    if not isinstance(payload, dict):
        return {}

    data = payload.get("data")
    if isinstance(data, dict):
        root = data
    else:
        root = payload

    item_candidates = [root]
    for key in ("item", "result", "offer", "product"):
        nested = root.get(key) if isinstance(root, dict) else None
        if isinstance(nested, dict):
            item_candidates.insert(0, nested)

    item: dict[str, Any] = {}
    for candidate in item_candidates:
        if not isinstance(candidate, dict):
            continue
        if any(
            key in candidate
            for key in (
                "title",
                "subject",
                "name",
                "item_id",
                "itemId",
                "images",
                "imgUrls",
                "skuMap",
                "skuProps",
            )
        ):
            item = candidate
            break
    if not item and isinstance(root, dict):
        item = root

    title = (
        str(
            item.get("title")
            or item.get("subject")
            or item.get("name")
            or item.get("itemTitle")
            or ""
        ).strip()
        or None
    )
    item_id = str(item.get("item_id") or item.get("itemId") or item.get("id") or "").strip() or None
    offer_url = str(item.get("url") or item.get("itemUrl") or root.get("url") or "").strip() or None

    supplier_name = (
        str(
            item.get("company_name")
            or item.get("companyName")
            or item.get("seller_name")
            or item.get("sellerName")
            or item.get("shop_name")
            or item.get("shopName")
            or ""
        ).strip()
        or None
    )

    images: list[str] = []
    for key in ("images", "imgUrls", "imageList", "detailImageList"):
        values = item.get(key)
        if isinstance(values, list):
            for value in values:
                if value:
                    image_url = str(value).strip()
                    if image_url and image_url not in images:
                        images.append(image_url)
    main_image = item.get("mainImage") or item.get("main_image") or item.get("image")
    if main_image:
        image_url = str(main_image).strip()
        if image_url and image_url not in images:
            images.insert(0, image_url)

    normalized = {
        "title": title,
        "item_id": item_id,
        "url": offer_url,
        "supplier_name": supplier_name,
        "images": images,
        "sku_count": len(item.get("skuMap") or item.get("skuProps") or []),
        "dimensions": {
            key: value
            for key, value in {
                "package_length_cm": _to_float_or_none(
                    item.get("length") or item.get("packageLength")
                ),
                "package_width_cm": _to_float_or_none(
                    item.get("width") or item.get("packageWidth")
                ),
                "package_height_cm": _to_float_or_none(
                    item.get("height") or item.get("packageHeight")
                ),
                "package_weight_kg": _to_float_or_none(
                    item.get("weight") or item.get("packageWeight")
                ),
            }.items()
            if value is not None
        },
        "raw": payload,
    }

    prices: list[Decimal] = []
    for price_key in ("price", "priceMin", "priceMax", "price_min", "price_max"):
        value = item.get(price_key)
        try:
            if value is not None:
                prices.append(to_money(value))
        except Exception:
            pass
    # Extract from nested price_info dict (TMAPI item_detail_by_url format)
    price_info = item.get("price_info")
    if isinstance(price_info, dict):
        for pk in ("price_min", "price_max", "price", "origin_price_min", "origin_price_max"):
            pv = price_info.get(pk)
            try:
                if pv is not None and str(pv).strip():
                    prices.append(to_money(pv))
            except Exception:
                pass
    if prices:
        normalized["price_min"] = str(min(prices))
        normalized["price_max"] = str(max(prices))

    normalized["skus"] = _parse_tmapi_1688_skus(item)
    return normalized


def _parse_tmapi_1688_skus(item: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Parse individual SKU variants from TMAPI 1688 response.
    Returns list of {sku_id, name, image, price, stock, props}.
    """
    sku_map_raw = item.get("skuMap") or item.get("sku_map")
    sku_props_raw = item.get("skuProps") or item.get("sku_props") or item.get("skuInfoMap")

    # Build prop-value → image lookup from skuProps
    prop_images: dict[str, str] = {}
    prop_names: list[dict[str, Any]] = []  # [{propName, values: [{name, image}]}]
    if isinstance(sku_props_raw, list):
        for prop in sku_props_raw:
            if not isinstance(prop, dict):
                continue
            prop_name = str(
                prop.get("propName")
                or prop.get("prop_name")
                or prop.get("prop")
                or prop.get("name")
                or ""
            ).strip()
            values_list: list[dict[str, Any]] = []
            for val in prop.get("values") or prop.get("value") or []:
                if not isinstance(val, dict):
                    continue
                val_name = str(val.get("name") or val.get("value") or "").strip()
                val_image = (
                    str(val.get("imageUrl") or val.get("image") or val.get("img") or "").strip()
                    or None
                )
                if val_name:
                    values_list.append({"name": val_name, "image": val_image})
                    if val_image:
                        prop_images[val_name] = val_image
            prop_names.append({"propName": prop_name, "values": values_list})

    skus: list[dict[str, Any]] = []

    if isinstance(sku_map_raw, dict):
        for combo_key, sku_data in sku_map_raw.items():
            if not isinstance(sku_data, dict):
                continue
            sku_id = str(
                sku_data.get("skuId") or sku_data.get("sku_id") or sku_data.get("id") or combo_key
            ).strip()
            price = None
            for pk in ("price", "salePrice", "discountPrice", "originalPrice"):
                pv = sku_data.get(pk)
                if pv is not None:
                    try:
                        price = float(str(pv))
                        break
                    except (ValueError, TypeError):
                        pass
            stock = None
            for sk in ("canBookCount", "stock", "quantity", "amountOnSale"):
                sv = sku_data.get(sk)
                if sv is not None:
                    try:
                        stock = int(float(str(sv)))
                        break
                    except (ValueError, TypeError):
                        pass

            # Resolve prop names from combo key (e.g. "红色&gt;S" or "红色>S")
            parts = [p.strip() for p in combo_key.replace("&gt;", ">").split(">") if p.strip()]
            name = " / ".join(parts) if parts else combo_key
            image = None
            for part in parts:
                if part in prop_images:
                    image = prop_images[part]
                    break

            skus.append(
                {
                    "sku_id": sku_id,
                    "name": name,
                    "image": image,
                    "price": price,
                    "stock": stock,
                    "props": parts,
                }
            )
    elif isinstance(sku_map_raw, list):
        # Some TMAPI versions return skuMap as a list
        for idx, sku_data in enumerate(sku_map_raw):
            if not isinstance(sku_data, dict):
                continue
            sku_id = str(
                sku_data.get("skuId") or sku_data.get("sku_id") or sku_data.get("id") or idx
            ).strip()
            price = None
            for pk in ("price", "salePrice", "discountPrice"):
                pv = sku_data.get(pk)
                if pv is not None:
                    try:
                        price = float(str(pv))
                        break
                    except (ValueError, TypeError):
                        pass
            name_parts = []
            for pk in ("specAttrs", "props", "attributes"):
                pv = sku_data.get(pk)
                if isinstance(pv, str):
                    name_parts = [p.strip() for p in pv.replace("&gt;", ">").split(">")]
                    break
            name = (
                " / ".join(name_parts)
                if name_parts
                else str(sku_data.get("name") or f"SKU {idx + 1}")
            )
            image = None
            for part in name_parts:
                if part in prop_images:
                    image = prop_images[part]
                    break
            skus.append(
                {
                    "sku_id": sku_id,
                    "name": name,
                    "image": image
                    or str(sku_data.get("imageUrl") or sku_data.get("image") or "").strip()
                    or None,
                    "price": price,
                    "stock": None,
                    "props": name_parts,
                }
            )

    # Handle TMAPI item_detail_by_url format: "skus" array with skuid/sale_price/props_names
    if not skus:
        skus_array = item.get("skus")
        if isinstance(skus_array, list):
            for idx, sku_data in enumerate(skus_array):
                if not isinstance(sku_data, dict):
                    continue
                sku_id = str(
                    sku_data.get("skuid") or sku_data.get("skuId") or sku_data.get("sku_id") or idx
                ).strip()
                price = None
                for pk in ("sale_price", "price", "salePrice", "discountPrice"):
                    pv = sku_data.get(pk)
                    if pv is not None:
                        try:
                            price = float(str(pv))
                            break
                        except (ValueError, TypeError):
                            pass
                stock_val = None
                sv = sku_data.get("stock")
                if sv is not None:
                    try:
                        stock_val = int(float(str(sv)))
                    except (ValueError, TypeError):
                        pass

                # Parse props_names string, e.g. "颜色:ZJ033-黑色【升降+旋转】"
                props_str = str(
                    sku_data.get("props_names") or sku_data.get("propsNames") or ""
                ).strip()
                name_parts: list[str] = []
                if props_str:
                    # Format: "propName:valueName;propName2:valueName2" or single "propName:valueName"
                    for segment in props_str.split(";"):
                        segment = segment.strip()
                        if ":" in segment:
                            val_part = segment.split(":", 1)[1].strip()
                            if val_part:
                                name_parts.append(val_part)
                        elif segment:
                            name_parts.append(segment)

                name = (
                    " / ".join(name_parts)
                    if name_parts
                    else str(sku_data.get("name") or f"SKU {idx + 1}")
                )
                image = None
                for part in name_parts:
                    if part in prop_images:
                        image = prop_images[part]
                        break
                skus.append(
                    {
                        "sku_id": sku_id,
                        "name": name,
                        "image": image
                        or str(sku_data.get("imageUrl") or sku_data.get("image") or "").strip()
                        or None,
                        "price": price,
                        "stock": stock_val,
                        "props": name_parts,
                    }
                )

    # If no skuMap but we have skuProps with single values, create one SKU per prop combination
    if not skus and prop_names:
        for prop_group in prop_names:
            for val in prop_group.get("values") or []:
                skus.append(
                    {
                        "sku_id": val["name"],
                        "name": val["name"],
                        "image": val.get("image"),
                        "price": None,
                        "stock": None,
                        "props": [val["name"]],
                    }
                )

    return skus


def merge_card_source(
    *,
    attributes: dict[str, Any] | None,
    source_key: str,
    source_kind: str,
    provider: str,
    external_ref: str | None,
    data: dict[str, Any],
    raw_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Merge source snapshot into master-card attributes.

    Stores data under attributes.sources[source_key], preserving other sources.
    """
    safe_attributes = dict(attributes) if isinstance(attributes, dict) else {}
    sources = safe_attributes.get("sources")
    if not isinstance(sources, dict):
        sources = {}

    merged_source = {
        "kind": source_kind,
        "provider": provider,
        "external_ref": external_ref,
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "data": data,
    }
    if raw_payload is not None:
        merged_source["raw_payload"] = raw_payload

    sources[source_key] = merged_source
    safe_attributes["sources"] = sources
    return safe_attributes


# ============================================================
# Supply chain: parsers & matrix builder
# ============================================================


def parse_ozon_cluster_stock(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Parse response from /v1/analytics/stocks into per-SKU-per-cluster rows.

    The API returns items[] with per-warehouse data.  Each item belongs to a
    (sku, cluster_id) pair and also carries global analytics fields.

    Required request format: POST /v1/analytics/stocks {"skus": [int, ...]}
    """
    items: list[Any] = []
    if isinstance(payload, dict):
        items = payload.get("items") or []
        result = payload.get("result")
        if isinstance(result, dict):
            items = result.get("items") or items
        elif isinstance(result, list):
            items = result
    if not isinstance(items, list):
        return []

    parsed: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        sku = item.get("sku")
        if not sku:
            continue
        try:
            sku_int = int(sku)
        except (ValueError, TypeError):
            continue

        cluster_id = item.get("cluster_id")
        if cluster_id is None:
            continue
        try:
            cluster_id_int = int(cluster_id)
        except (ValueError, TypeError):
            continue

        warehouse_id = 0
        raw_wh = item.get("warehouse_id")
        if raw_wh is not None:
            try:
                warehouse_id = int(raw_wh)
            except (ValueError, TypeError):
                pass

        # Per-cluster analytics
        ads_cluster = _safe_numeric(item.get("ads_cluster"))
        idc_cluster = _safe_int(item.get("idc_cluster"))
        turnover_cluster = str(item.get("turnover_grade_cluster") or "")
        days_no_sales_cluster = _safe_int(item.get("days_without_sales_cluster"))

        # Global analytics (same for all clusters of same SKU)
        ads_global = _safe_numeric(item.get("ads"))
        idc_global = _safe_int(item.get("idc"))
        turnover_global = str(item.get("turnover_grade") or "")

        # Item tags
        raw_tags = item.get("item_tags")
        item_tags: list[str] = []
        if isinstance(raw_tags, list):
            item_tags = [str(t) for t in raw_tags if t]

        parsed.append(
            {
                "ozon_sku": sku_int,
                "offer_id": str(item.get("offer_id") or ""),
                "cluster_id": cluster_id_int,
                "cluster_name": str(item.get("cluster_name") or ""),
                "warehouse_id": warehouse_id,
                "warehouse_name": str(item.get("warehouse_name") or ""),
                "available": _safe_int(item.get("available_stock_count")) or 0,
                "in_transit": _safe_int(item.get("transit_stock_count")) or 0,
                "reserved": (
                    (_safe_int(item.get("valid_stock_count")) or 0)
                    + (_safe_int(item.get("requested_stock_count")) or 0)
                ),
                "ads_cluster": ads_cluster,
                "idc_cluster": idc_cluster,
                "turnover_cluster": turnover_cluster or None,
                "days_no_sales_cluster": days_no_sales_cluster,
                "ads_global": ads_global,
                "idc_global": idc_global,
                "turnover_global": turnover_global or None,
                "item_tags": item_tags,
            }
        )
    return parsed


def _safe_numeric(value: Any) -> Decimal | None:
    """Parse a numeric value, returning None if invalid/missing."""
    if value is None:
        return None
    try:
        return Decimal(str(value)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return None


def _safe_int(value: Any) -> int | None:
    """Parse an int value, returning None if invalid/missing."""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def parse_ozon_supply_orders(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse response from /v1/supply-order/list into normalized dicts."""
    items: list[Any] = []
    if isinstance(payload, dict):
        items = payload.get("supply_orders") or payload.get("items") or []
        result = payload.get("result")
        if isinstance(result, dict):
            items = result.get("supply_orders") or result.get("items") or items
        elif isinstance(result, list):
            items = result
    if not isinstance(items, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        supply_order_id = item.get("supply_order_id") or item.get("id") or item.get("order_id")
        if not supply_order_id:
            continue
        normalized.append(
            {
                "supply_order_id": int(supply_order_id),
                "supply_number": str(
                    item.get("supply_order_number")
                    or item.get("number")
                    or item.get("supply_number")
                    or ""
                ),
                "status": str(item.get("state") or item.get("status") or "UNKNOWN").upper(),
                "warehouse_name": item.get("warehouse_name")
                or (item.get("warehouse") or {}).get("name"),
                "warehouse_id": item.get("warehouse_id") or (item.get("warehouse") or {}).get("id"),
                "created_at": item.get("created_at") or item.get("creation_date"),
                "updated_at": item.get("updated_at") or item.get("last_updated"),
                "total_items_planned": int(item.get("total_items_planned") or 0),
                "total_items_accepted": int(item.get("total_items_accepted") or 0),
                "raw": item,
            }
        )
    return normalized


def parse_ozon_supply_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse response from /v1/supply-order/items into normalized dicts."""
    items: list[Any] = []
    if isinstance(payload, dict):
        items = payload.get("items") or payload.get("products") or []
        result = payload.get("result")
        if isinstance(result, dict):
            items = result.get("items") or result.get("products") or items
        elif isinstance(result, list):
            items = result
    if not isinstance(items, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        offer_id = str(item.get("offer_id") or item.get("article") or "")
        sku = item.get("sku") or item.get("fbo_sku") or 0
        planned = int(item.get("quantity") or item.get("quantity_planned") or 0)
        accepted = int(item.get("accepted") or item.get("quantity_accepted") or 0)
        rejected = int(
            item.get("rejected") or item.get("quantity_rejected") or max(0, planned - accepted)
        )
        normalized.append(
            {
                "offer_id": offer_id,
                "sku": int(sku) if sku else 0,
                "name": item.get("name") or item.get("product_name") or "",
                "quantity_planned": planned,
                "quantity_accepted": accepted,
                "quantity_rejected": rejected,
            }
        )
    return normalized


def build_supply_chain_matrix(
    cards: list[dict[str, Any]],
    order_agg: dict[str, dict[str, Any]],
    supply_total_agg: dict[str, float],
    stock_agg: dict[str, float],
    postings_agg: dict[str, dict[str, Any]],
    returns_agg: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Build supply chain matrix rows (one per master_card).

    Columns: Поставщик (Заказ, Получено) | Склад (В наличии, Отгружено) |
             Озон (На складе, Доставляется, Выкуплено, Едет на склад)
    """
    rows: list[dict[str, Any]] = []
    for card in cards:
        cid = str(card.get("id", ""))
        if not cid:
            continue

        oa = order_agg.get(cid, {})
        pa = postings_agg.get(cid, {})
        ra = returns_agg.get(cid, {})

        ordered = int(oa.get("ordered", 0))
        received = int(oa.get("received", 0))
        warehouse_stock = float(card.get("warehouse_qty") or 0)
        shipped_to_ozon = int(supply_total_agg.get(cid, 0))
        ozon_stock = int(stock_agg.get(cid, 0))

        # Postings: total, cancelled, delivered (gross)
        total_qty = int(pa.get("total_qty", 0))
        cancelled_qty = int(pa.get("cancelled_qty", 0))
        delivered_gross = int(pa.get("delivered_gross", 0))

        # Returns: customer returns (post-delivery) + in-transit (all types)
        customer_returns = int(ra.get("customer_returns", 0))
        returns_in_transit = int(ra.get("in_transit", 0))

        # Derived columns
        delivering_qty = total_qty - cancelled_qty - delivered_gross
        purchased_qty = max(0, delivered_gross - customer_returns)

        rows.append(
            {
                "master_card_id": cid,
                "sku": card.get("sku") or "",
                "title": card.get("title") or "",
                "ordered_qty": ordered,
                "received_qty": received,
                "warehouse_stock": warehouse_stock,
                "shipped_to_ozon": shipped_to_ozon,
                "ozon_stock": ozon_stock,
                "delivering_qty": delivering_qty,
                "purchased_qty": purchased_qty,
                "returns_in_transit": returns_in_transit,
            }
        )

    rows.sort(key=lambda r: r["sku"])
    return rows
