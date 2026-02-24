"""Legacy v1 sale creation — thin wrapper around sales_service.create_sale().

Kept for backward compatibility with ozon_sync.sync_ozon_sales which passes
a SaleCreateRequest Pydantic model.
"""

from __future__ import annotations

from typing import Any

import asyncpg
from proxy.src.routes.admin_models import SaleCreateRequest
from proxy.src.services.admin.sales_service import create_sale as _create_sale_v2


async def create_sale(
    *,
    conn: asyncpg.Connection,
    actor_user_id: str,
    payload: SaleCreateRequest,
    source: str,
    record_finance_transactions: bool = True,
) -> dict[str, Any]:
    """Convert SaleCreateRequest model to dict items and delegate to sales_service."""
    items = [
        {
            "master_card_id": item.master_card_id,
            "quantity": item.quantity,
            "unit_sale_price_rub": item.unit_sale_price_rub,
            "fee_rub": item.fee_rub,
            "extra_cost_rub": item.extra_cost_rub,
            "source_offer_id": item.source_offer_id,
        }
        for item in payload.items
    ]

    return await _create_sale_v2(
        conn,
        user_id=actor_user_id,
        marketplace=payload.marketplace,
        external_order_id=payload.external_order_id,
        sold_at=payload.sold_at,
        status=payload.status,
        items=items,
        raw_payload=payload.raw_payload,
        source=source,
        record_finance_transactions=record_finance_transactions,
    )
