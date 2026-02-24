from datetime import datetime

from fastapi import HTTPException
from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.services.admin import finance_service

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def finance_list(
    date_from: str = "",
    date_to: str = "",
    kind: str = "",
    category: str = "",
    limit: int = 50,
    offset: int = 0,
) -> str:
    """List finance transactions with optional filters.

    Args:
        date_from: Start date YYYY-MM-DD (default 30 days ago).
        date_to: End date YYYY-MM-DD (default today).
        kind: Filter by kind — 'income' or 'expense'.
        category: Filter by category (e.g. 'purchase', 'sales_income', 'marketplace_fee').
        limit: Max results (default 50).
        offset: Pagination offset.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        result = await finance_service.list_transactions(
            conn,
            user_id=deps.user_id,
            date_from=date_from or None,
            date_to=date_to or None,
            kind=kind or None,
            category=category or None,
            limit=min(limit, 200),
            offset=offset,
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def finance_create(
    kind: str,
    category: str,
    amount_rub: float,
    happened_at: str = "",
    subcategory: str = "",
    notes: str = "",
    source: str = "mcp",
) -> str:
    """Create a finance transaction.

    Args:
        kind: 'income' or 'expense' (required).
        category: Transaction category (required). Common: 'purchase', 'sales_income',
                  'marketplace_fee', 'logistics', 'salary', 'ads', 'other'.
        amount_rub: Amount in RUB (positive number).
        happened_at: Transaction datetime ISO 8601 (default now).
        subcategory: Optional subcategory.
        notes: Free-text description.
        source: Source system (default 'mcp').
    """
    deps = get_deps()
    effective_at = datetime.fromisoformat(happened_at) if happened_at else None
    async with deps.pool.acquire() as conn:
        result = await finance_service.create_transaction(
            conn,
            user_id=deps.user_id,
            happened_at=effective_at,
            kind=kind,
            category=category,
            subcategory=subcategory or None,
            amount_rub=amount_rub,
            source=source,
            external_id=None,
            related_entity_type=None,
            related_entity_id=None,
            notes=notes or None,
            payload={},
        )
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def finance_update(
    txn_id: str,
    kind: str = "",
    category: str = "",
    amount_rub: float = 0,
    happened_at: str = "",
    notes: str = "",
) -> str:
    """Update a finance transaction.

    Args:
        txn_id: UUID of the transaction (required).
        kind: Updated kind ('income' or 'expense'). Empty = no change.
        category: Updated category. Empty = no change.
        amount_rub: Updated amount in RUB. 0 = no change.
        happened_at: Updated datetime ISO 8601. Empty = no change.
        notes: Updated notes. Empty = no change.
    """
    deps = get_deps()
    effective_at = datetime.fromisoformat(happened_at) if happened_at else None
    async with deps.pool.acquire() as conn:
        result = await finance_service.update_transaction(
            conn,
            user_id=deps.user_id,
            txn_id=txn_id,
            happened_at=effective_at,
            kind=kind or None,
            category=category or None,
            amount_rub=amount_rub or None,
            notes=notes or None,
        )
    if not result:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return serialize_result(result)


@mcp.tool()
@mcp_error_handler
async def finance_delete(txn_id: str) -> str:
    """Delete a finance transaction.

    Args:
        txn_id: UUID of the transaction.
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        deleted = await finance_service.delete_transaction(
            conn,
            user_id=deps.user_id,
            txn_id=txn_id,
        )
    if not deleted:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return serialize_result({"deleted": True, "txn_id": txn_id})
