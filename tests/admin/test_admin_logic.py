from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from proxy.src.services.admin_logic import (
    FifoLot,
    InsufficientInventoryError,
    allocate_fifo,
    build_dds_report,
    build_pnl_report,
    calculate_purchase_unit_cost,
    calculate_sale_metrics,
    extract_ozon_products_cursor,
    merge_card_source,
    parse_ozon_finance_transactions,
    parse_ozon_postings,
    parse_ozon_products,
    parse_tmapi_1688_item,
)


def test_allocate_fifo_uses_oldest_lots_first() -> None:
    lots = [
        FifoLot(
            lot_id="new",
            remaining_qty=Decimal("10"),
            unit_cost_rub=Decimal("130"),
            received_at=datetime(2026, 1, 10, tzinfo=UTC),
        ),
        FifoLot(
            lot_id="old",
            remaining_qty=Decimal("5"),
            unit_cost_rub=Decimal("100"),
            received_at=datetime(2026, 1, 1, tzinfo=UTC),
        ),
    ]
    allocations = allocate_fifo(lots, Decimal("7"))
    assert len(allocations) == 2
    assert allocations[0].lot_id == "old"
    assert allocations[0].quantity == Decimal("5.000")
    assert allocations[1].lot_id == "new"
    assert allocations[1].quantity == Decimal("2.000")


def test_allocate_fifo_raises_when_not_enough() -> None:
    lots = [
        FifoLot(
            lot_id="only",
            remaining_qty=Decimal("1"),
            unit_cost_rub=Decimal("100"),
            received_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
    ]
    with pytest.raises(InsufficientInventoryError):
        allocate_fifo(lots, Decimal("2"))


def test_purchase_unit_cost_calculation() -> None:
    unit_cost = calculate_purchase_unit_cost(
        quantity=Decimal("10"),
        purchase_price_rub=Decimal("1000"),
        packaging_cost_rub=Decimal("50"),
        logistics_cost_rub=Decimal("150"),
        customs_cost_rub=Decimal("0"),
        extra_cost_rub=Decimal("0"),
    )
    assert unit_cost == Decimal("120.00")


def test_sale_metrics_calculation() -> None:
    allocations = allocate_fifo(
        [
            FifoLot(
                lot_id="l1",
                remaining_qty=Decimal("2"),
                unit_cost_rub=Decimal("100"),
                received_at=datetime(2026, 1, 1, tzinfo=UTC),
            )
        ],
        Decimal("2"),
    )
    metrics = calculate_sale_metrics(
        quantity=Decimal("2"),
        unit_sale_price_rub=Decimal("300"),
        fee_rub=Decimal("50"),
        extra_cost_rub=Decimal("10"),
        allocations=allocations,
    )
    assert metrics["revenue_rub"] == Decimal("600.00")
    assert metrics["cogs_rub"] == Decimal("200.00")
    assert metrics["gross_profit_rub"] == Decimal("340.00")


def test_dds_report_aggregation() -> None:
    report = build_dds_report(
        [
            {
                "happened_at": "2026-02-01T10:00:00Z",
                "kind": "income",
                "category": "sales",
                "amount_rub": 1000,
            },
            {
                "happened_at": "2026-02-01T11:00:00Z",
                "kind": "expense",
                "category": "ads",
                "amount_rub": 200,
            },
            {
                "happened_at": "2026-02-02T11:00:00Z",
                "kind": "expense",
                "category": "rent",
                "amount_rub": 300,
            },
        ]
    )
    assert report["totals"]["income_rub"] == Decimal("1000.00")
    assert report["totals"]["expense_rub"] == Decimal("500.00")
    assert report["totals"]["net_cashflow_rub"] == Decimal("500.00")
    assert len(report["rows"]) == 2


def test_pnl_report_aggregation() -> None:
    report = build_pnl_report(
        sales_rows=[
            {
                "sold_at": "2026-02-01T10:00:00Z",
                "revenue_rub": 1000,
                "cogs_rub": 400,
                "fee_rub": 100,
                "extra_cost_rub": 0,
            }
        ],
        operating_expense_rows=[
            {"happened_at": "2026-02-01T12:00:00Z", "amount_rub": 150},
        ],
        group_by="day",
    )
    totals = report["totals"]
    assert totals["revenue_rub"] == Decimal("1000.00")
    assert totals["gross_profit_rub"] == Decimal("500.00")
    assert totals["net_profit_rub"] == Decimal("350.00")


def test_parse_ozon_finance_transactions() -> None:
    payload = {
        "result": {
            "operations": [
                {
                    "operation_id": "op1",
                    "operation_date": "2026-02-01T00:00:00Z",
                    "operation_type_name": "Sale",
                    "amount": "1234.56",
                },
                {
                    "operation_id": "op2",
                    "operation_date": "2026-02-01T01:00:00Z",
                    "operation_type_name": "Commission",
                    "amount": "-100.00",
                },
            ]
        }
    }
    parsed = parse_ozon_finance_transactions(payload)
    assert len(parsed) == 2
    assert parsed[0]["kind"] == "income"
    assert parsed[0]["amount_rub"] == Decimal("1234.56")
    assert parsed[1]["kind"] == "expense"
    assert parsed[1]["amount_rub"] == Decimal("100.00")


def test_parse_ozon_postings() -> None:
    payload = {
        "result": {
            "postings": [
                {
                    "posting_number": "P-001",
                    "in_process_at": "2026-02-01T10:00:00Z",
                    "products": [
                        {
                            "offer_id": "SKU-1",
                            "quantity": 2,
                            "price": "500",
                            "commission_amount": "40",
                        }
                    ],
                }
            ]
        }
    }
    postings = parse_ozon_postings(payload)
    assert len(postings) == 1
    assert postings[0]["external_order_id"] == "P-001"
    assert postings[0]["items"][0]["offer_id"] == "SKU-1"
    assert postings[0]["items"][0]["unit_sale_price_rub"] == Decimal("500.00")
    assert postings[0]["items"][0]["fee_rub"] == Decimal("40.00")


def test_parse_ozon_postings_supports_v2_result_list() -> None:
    payload = {
        "result": [
            {
                "posting_number": "43403566-3022-1",
                "created_at": "2026-01-27T14:28:14.712387Z",
                "in_process_at": "2026-01-27T14:28:26.177228Z",
                "products": [
                    {
                        "sku": 3267372720,
                        "offer_id": "manle8mhqc4vcs7meitm",
                        "quantity": 1,
                        "price": "250.00",
                    }
                ],
                "financial_data": {
                    "products": [
                        {
                            "product_id": 3267372720,
                            "commission_amount": -50,
                        }
                    ]
                },
            }
        ]
    }
    postings = parse_ozon_postings(payload)
    assert len(postings) == 1
    assert postings[0]["external_order_id"] == "43403566-3022-1"
    assert postings[0]["items"][0]["offer_id"] == "manle8mhqc4vcs7meitm"
    assert postings[0]["items"][0]["quantity"] == Decimal("1.000")
    assert postings[0]["items"][0]["unit_sale_price_rub"] == Decimal("250.00")
    assert postings[0]["items"][0]["fee_rub"] == Decimal("50.00")


def test_parse_ozon_postings_normalizes_negative_product_fee_to_positive() -> None:
    payload = {
        "result": {
            "postings": [
                {
                    "posting_number": "P-NEG",
                    "in_process_at": "2026-02-01T10:00:00Z",
                    "products": [
                        {
                            "offer_id": "SKU-NEG",
                            "quantity": 1,
                            "price": "1000",
                            "commission_amount": "-123.45",
                        }
                    ],
                }
            ]
        }
    }
    postings = parse_ozon_postings(payload)
    assert len(postings) == 1
    assert postings[0]["items"][0]["fee_rub"] == Decimal("123.45")


def test_parse_ozon_products() -> None:
    payload = {
        "result": {
            "items": [
                {
                    "product_id": 1001,
                    "offer_id": "OFF-1",
                    "sku": "SKU-1",
                    "name": "Test Product",
                    "brand": "BrandX",
                    "description": "Desc",
                    "images": ["https://img.example/1.jpg"],
                    "dimensions": {"length": 12, "width": 5, "height": 3, "weight": 0.4},
                }
            ],
            "last_id": "CURSOR-1",
        }
    }
    products = parse_ozon_products(payload)
    assert len(products) == 1
    assert products[0]["offer_id"] == "OFF-1"
    assert products[0]["product_id"] == "1001"
    assert products[0]["dimensions"]["package_length_cm"] == 12.0
    assert extract_ozon_products_cursor(payload) == "CURSOR-1"


def test_parse_ozon_products_supports_v4_attributes_units_mm_g() -> None:
    payload = {
        "result": [
            {
                "id": 2772732427,
                "offer_id": "подставка360",
                "name": "Подставка",
                "depth": 270,
                "width": 240,
                "height": 60,
                "dimension_unit": "mm",
                "weight": 1500,
                "weight_unit": "g",
                "images": ["https://cdn.example/1.jpg"],
            }
        ],
        "total": 1,
        "last_id": "",
    }
    products = parse_ozon_products(payload)
    assert len(products) == 1
    assert products[0]["product_id"] == "2772732427"
    assert products[0]["offer_id"] == "подставка360"
    assert products[0]["title"] == "Подставка"
    assert products[0]["dimensions"]["package_length_cm"] == 27.0
    assert products[0]["dimensions"]["package_width_cm"] == 24.0
    assert products[0]["dimensions"]["package_height_cm"] == 6.0
    assert products[0]["dimensions"]["package_weight_kg"] == 1.5


def test_parse_tmapi_1688_item() -> None:
    payload = {
        "data": {
            "item": {
                "itemId": 555,
                "title": "1688 Product",
                "url": "https://detail.1688.com/offer/555.html",
                "sellerName": "Supplier A",
                "images": ["https://img.example/1.jpg", "https://img.example/2.jpg"],
                "priceMin": "10.50",
                "priceMax": "12.00",
            }
        }
    }
    parsed = parse_tmapi_1688_item(payload)
    assert parsed["item_id"] == "555"
    assert parsed["title"] == "1688 Product"
    assert parsed["supplier_name"] == "Supplier A"
    assert parsed["price_min"] == "10.50"
    assert parsed["price_max"] == "12.00"
    assert len(parsed["images"]) == 2


def test_merge_card_source_preserves_existing_sources() -> None:
    attrs = {
        "sources": {
            "manual:1": {"provider": "manual", "kind": "manual", "data": {"note": "existing"}}
        }
    }
    merged = merge_card_source(
        attributes=attrs,
        source_key="ozon:abc",
        source_kind="marketplace",
        provider="ozon",
        external_ref="OFF-1",
        data={"title": "Ozon Product"},
        raw_payload={"offer_id": "OFF-1"},
    )
    assert "manual:1" in merged["sources"]
    assert "ozon:abc" in merged["sources"]
    assert merged["sources"]["ozon:abc"]["provider"] == "ozon"
    assert merged["sources"]["ozon:abc"]["data"]["title"] == "Ozon Product"
