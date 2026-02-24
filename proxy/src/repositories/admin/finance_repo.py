from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import asyncpg
from proxy.src.repositories.admin.base import safe_execute, safe_fetch, safe_fetchone
from proxy.src.routes.admin.list_query import ListQuery, WhereBuilder

FINANCE_SORT_MAP = {
    "happened_at": "happened_at",
    "amount_rub": "amount_rub",
}


async def insert_purchase_transaction(
    conn: asyncpg.Connection,
    *,
    happened_at: Any,
    amount_rub: Decimal,
    order_id: str,
    order_number: str,
    notes_prefix: str,
    payload: dict[str, Any],
    user_id: str,
) -> None:
    await safe_execute(
        conn,
        """
        INSERT INTO finance_transactions (
            happened_at, kind, category, amount_rub, source,
            external_id, related_entity_type, related_entity_id,
            notes, payload, user_id
        )
        VALUES (
            $1, 'expense', 'purchase', $2, 'supplier_order',
            $3, 'supplier_order', $4, $5, $6, $7
        )
        ON CONFLICT (source, external_id) DO NOTHING
        """,
        happened_at,
        amount_rub,
        f"purchase:{order_id}",
        order_id,
        f"{notes_prefix}: {order_number}",
        json.dumps(payload),
        user_id,
    )


async def list_transactions(
    conn: asyncpg.Connection,
    *,
    user_id: str,
    lq: ListQuery,
    start_dt: Any,
    end_dt: Any,
    kind: str | None,
    category: str | None,
    source: str | None = None,
) -> tuple[list[asyncpg.Record], int]:
    wb = WhereBuilder()
    wb.exact("user_id", user_id)
    wb.date_range("happened_at", start_dt, end_dt)
    wb.exact_optional("kind", kind)
    wb.exact_optional("category", category)
    wb.exact_optional("source", source)
    wb.ilike_multi(["category", "notes"], lq.q)

    where_sql, params = wb.build()

    total_row = await safe_fetchone(
        conn,
        f"SELECT COUNT(*) AS total FROM finance_transactions {where_sql}",
        *params,
    )
    total = int(total_row["total"]) if total_row else 0

    sort_col = FINANCE_SORT_MAP[lq.sort_field]
    limit_idx = len(params) + 1
    offset_idx = len(params) + 2

    rows = await safe_fetch(
        conn,
        f"""
        SELECT *
        FROM finance_transactions
        {where_sql}
        ORDER BY {sort_col} {lq.sort_dir}
        LIMIT ${limit_idx} OFFSET ${offset_idx}
        """,
        *params,
        lq.limit,
        lq.offset,
    )
    return rows, total


async def create_transaction(
    conn: asyncpg.Connection,
    *,
    happened_at: Any,
    kind: str,
    category: str,
    subcategory: str | None,
    amount_rub: Decimal,
    source: str,
    external_id: str | None,
    related_entity_type: str | None,
    related_entity_id: str | None,
    notes: str | None,
    payload_json: str,
    user_id: str,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        INSERT INTO finance_transactions (
            happened_at, kind, category, subcategory, amount_rub,
            source, external_id, related_entity_type, related_entity_id,
            notes, payload, user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
        """,
        happened_at,
        kind,
        category,
        subcategory,
        amount_rub,
        source,
        external_id,
        related_entity_type,
        related_entity_id,
        notes,
        payload_json,
        user_id,
    )


async def update_transaction(
    conn: asyncpg.Connection,
    *,
    txn_id: str,
    user_id: str,
    happened_at: Any | None,
    kind: str | None,
    category: str | None,
    amount_rub: Decimal | None,
    notes: str | None,
) -> asyncpg.Record | None:
    return await safe_fetchone(
        conn,
        """
        UPDATE finance_transactions
        SET happened_at   = COALESCE($3, happened_at),
            kind          = COALESCE($4, kind),
            category      = COALESCE($5, category),
            amount_rub    = COALESCE($6, amount_rub),
            notes         = COALESCE($7, notes)
        WHERE id = $1 AND user_id = $2
        RETURNING *
        """,
        txn_id,
        user_id,
        happened_at,
        kind,
        category,
        amount_rub,
        notes,
    )


async def delete_transaction(conn: asyncpg.Connection, *, txn_id: str, user_id: str) -> bool:
    result = await safe_execute(
        conn,
        "DELETE FROM finance_transactions WHERE id = $1 AND user_id = $2",
        txn_id,
        user_id,
    )
    return result == "DELETE 1" if result else False


async def delete_purchase_transaction(
    conn: asyncpg.Connection, *, order_id: str, user_id: str
) -> None:
    await safe_execute(
        conn,
        """
        DELETE FROM finance_transactions
        WHERE source = 'supplier_order'
          AND external_id = $1
          AND user_id = $2
        """,
        f"purchase:{order_id}",
        user_id,
    )
