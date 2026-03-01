"""Parsers for Ozon Seller API responses.

Pure functions that normalize various Ozon API payloads into
structured dicts consumed by sync routes and services.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from hashlib import sha256
from typing import Any

from proxy.src.services.admin.utils import MONEY_QUANT, to_money


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Finance transaction classification
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Finance transactions parser
# ---------------------------------------------------------------------------


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
            or datetime.now(timezone.utc).isoformat()
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
# Unit Economics — service type mapping & per-operation parser
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


# ---------------------------------------------------------------------------
# Products parser
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Cluster stock parser
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Supply chain matrix builder
# ---------------------------------------------------------------------------


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
                "returns_in_