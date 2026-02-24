from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from proxy.src.config import settings
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.pagination import (
    decode_cursor,
    encode_cursor,
    parse_datetime_cursor,
    parse_sort,
)
from proxy.src.routes.admin.serialization import serialize_value
from proxy.src.routes.admin_helpers import (
    _get_admin_ozon_creds,
    _masked_credential,
    _safe_execute,
    _safe_fetch,
    _safe_fetchone,
)
from proxy.src.routes.admin_models import OzonCredentialsUpsertRequest
from proxy.src.routes.admin.response_models import (
    OkResponse,
    OzonAccountItemResponse,
    OzonIntegrationResponse,
)
from pydantic import BaseModel, Field

router = APIRouter(tags=["Integrations"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class PageInfo(BaseModel):
    limit: int
    sort: str
    next_cursor: str | None = None
    has_more: bool


class OzonAccountCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    client_id: str = Field(min_length=1, max_length=100)
    api_key: str = Field(min_length=1, max_length=255)
    is_active: bool = True
    is_default: bool = False


class OzonAccountUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    client_id: str | None = Field(default=None, min_length=1, max_length=100)
    api_key: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None
    is_default: bool | None = None


class OzonAccountView(BaseModel):
    id: str
    name: str
    is_active: bool
    is_default: bool
    has_credentials: bool
    client_id_masked: str | None = None
    api_key_masked: str | None = None
    created_at: str
    updated_at: str


class OzonAccountsListResponse(BaseModel):
    items: list[OzonAccountView]
    page: PageInfo


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 6:
        return "*" * len(value)
    return f"{value[:3]}{'*' * (len(value) - 6)}{value[-3:]}"


def _ozon_account_view(row: dict[str, Any]) -> dict[str, Any]:
    client_id = str(row["client_id"]).strip() if row.get("client_id") else None
    api_key = str(row["api_key"]).strip() if row.get("api_key") else None
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "is_active": bool(row["is_active"]),
        "is_default": bool(row["is_default"]),
        "has_credentials": bool(client_id and api_key),
        "client_id_masked": _mask(client_id),
        "api_key_masked": _mask(api_key),
        "created_at": serialize_value(row["created_at"]),
        "updated_at": serialize_value(row["updated_at"]),
    }


# ---------------------------------------------------------------------------
# Legacy single-account endpoints (/integrations/ozon)
# ---------------------------------------------------------------------------


@router.get("/integrations/ozon", response_model=OzonIntegrationResponse)
async def get_ozon_integration(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Получение текущих credentials Ozon (маскированные)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        client_id, api_key = await _get_admin_ozon_creds(conn, str(admin["id"]))
    return {
        "has_credentials": bool(client_id and api_key),
        "client_id_masked": _masked_credential(client_id),
        "api_key_masked": _masked_credential(api_key),
    }


@router.put("/integrations/ozon", response_model=OkResponse)
async def upsert_ozon_integration(
    payload: OzonCredentialsUpsertRequest,
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Сохранение или обновление Ozon Client-Id и Api-Key (зашифрованные)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        await _safe_execute(
            conn,
            """
            UPDATE admin_users
            SET ozon_client_id_enc = pgp_sym_encrypt($2, $4),
                ozon_api_key_enc = pgp_sym_encrypt($3, $4),
                ozon_client_id = NULL,
                ozon_api_key = NULL,
                updated_at = NOW()
            WHERE id = $1
            """,
            admin["id"],
            payload.client_id.strip(),
            payload.api_key.strip(),
            settings.hmac_secret,
        )
    return {"ok": True}


@router.delete("/integrations/ozon", response_model=OkResponse)
async def clear_ozon_integration(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Удаление Ozon credentials из аккаунта."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        await _safe_execute(
            conn,
            """
            UPDATE admin_users
            SET ozon_client_id = NULL,
                ozon_api_key = NULL,
                ozon_client_id_enc = NULL,
                ozon_api_key_enc = NULL,
                updated_at = NOW()
            WHERE id = $1
            """,
            admin["id"],
        )
    return {"ok": True}


# ---------------------------------------------------------------------------
# V2 multi-account endpoints (/integrations/ozon/accounts)
# ---------------------------------------------------------------------------


@router.get("/integrations/ozon/accounts", response_model=OzonAccountsListResponse)
async def list_ozon_accounts(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None),
    sort: str = Query(default="created_at:desc"),
    q: str | None = Query(default=None, max_length=120),
    is_active: bool | None = Query(default=None),
) -> OzonAccountsListResponse:
    """Список Ozon-аккаунтов с cursor-пагинацией и фильтрами."""
    parsed_sort = parse_sort(
        sort, allowed_fields={"created_at", "updated_at"}, default="created_at:desc"
    )
    cursor_payload = decode_cursor(cursor)

    where = ["user_id = $1"]
    params: list[Any] = [user["id"]]

    if q:
        params.append(q.strip())
        where.append(f"name ILIKE '%' || ${len(params)} || '%'")

    if is_active is not None:
        params.append(is_active)
        where.append(f"is_active = ${len(params)}")

    if cursor_payload:
        cursor_value, cursor_id = cursor_payload
        cursor_dt = parse_datetime_cursor(cursor_value)
        params.extend([cursor_dt, cursor_id])
        op = "<" if parsed_sort.direction == "desc" else ">"
        sort_col = parsed_sort.field
        where.append(
            f"(({sort_col}, id::text) {op} (${len(params) - 1}::timestamptz, ${len(params)}::text))"
        )

    params.append(settings.hmac_secret)
    decrypt_idx = len(params)

    params.append(limit + 1)
    limit_idx = len(params)

    query = f"""
        SELECT
            id,
            name,
            is_active,
            is_default,
            created_at,
            updated_at,
            pgp_sym_decrypt(client_id_enc, ${decrypt_idx}) AS client_id,
            pgp_sym_decrypt(api_key_enc, ${decrypt_idx}) AS api_key
        FROM admin_ozon_accounts
        WHERE {" AND ".join(where)}
        ORDER BY {parsed_sort.field} {parsed_sort.direction}, id {parsed_sort.direction}
        LIMIT ${limit_idx}
    """

    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        rows = await _safe_fetch(conn, query, *params)

    has_more = len(rows) > limit
    page_rows = rows[:limit]
    items = [_ozon_account_view(dict(row)) for row in page_rows]

    next_cursor: str | None = None
    if has_more and page_rows:
        last = page_rows[-1]
        next_cursor = encode_cursor(str(last[parsed_sort.field].isoformat()), str(last["id"]))

    return OzonAccountsListResponse(
        items=[OzonAccountView(**item) for item in items],
        page=PageInfo(
            limit=limit,
            sort=f"{parsed_sort.field}:{parsed_sort.direction}",
            next_cursor=next_cursor,
            has_more=has_more,
        ),
    )


@router.post("/integrations/ozon/accounts", response_model=OzonAccountItemResponse)
async def create_ozon_account(
    payload: OzonAccountCreateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, OzonAccountView]:
    """Создание нового Ozon-аккаунта с зашифрованными credentials."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        async with conn.transaction():
            if payload.is_default:
                await _safe_execute(
                    conn,
                    "UPDATE admin_ozon_accounts SET is_default = FALSE WHERE user_id = $1",
                    user["id"],
                )

            row = await _safe_fetchone(
                conn,
                """
                INSERT INTO admin_ozon_accounts (
                    user_id,
                    name,
                    client_id_enc,
                    api_key_enc,
                    is_active,
                    is_default
                )
                VALUES (
                    $1,
                    $2,
                    pgp_sym_encrypt($3, $7),
                    pgp_sym_encrypt($4, $7),
                    $5,
                    $6
                )
                RETURNING id, name, is_active, is_default, created_at, updated_at,
                    pgp_sym_decrypt(client_id_enc, $7) AS client_id,
                    pgp_sym_decrypt(api_key_enc, $7) AS api_key
                """,
                user["id"],
                payload.name.strip(),
                payload.client_id.strip(),
                payload.api_key.strip(),
                payload.is_active,
                payload.is_default,
                settings.hmac_secret,
            )

    return {"item": OzonAccountView(**_ozon_account_view(dict(row)))}


@router.patch("/integrations/ozon/accounts/{account_id}", response_model=OzonAccountItemResponse)
async def update_ozon_account(
    account_id: str,
    payload: OzonAccountUpdateRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, OzonAccountView]:
    """Частичное обновление Ozon-аккаунта (имя, credentials, статус)."""
    pool = get_db_pool(request)

    async with pool.acquire() as conn:
        async with conn.transaction():
            account = await _safe_fetchone(
                conn,
                "SELECT id FROM admin_ozon_accounts WHERE id = $1 AND user_id = $2",
                account_id,
                user["id"],
            )
            if not account:
                raise HTTPException(status_code=404, detail="Ozon account not found")

            if payload.is_default is True:
                await _safe_execute(
                    conn,
                    "UPDATE admin_ozon_accounts SET is_default = FALSE WHERE user_id = $1",
                    user["id"],
                )

            updates: list[str] = []
            values: list[Any] = []
            if payload.name is not None:
                values.append(payload.name.strip())
                updates.append(f"name = ${len(values)}")
            if payload.is_active is not None:
                values.append(payload.is_active)
                updates.append(f"is_active = ${len(values)}")
            if payload.is_default is not None:
                values.append(payload.is_default)
                updates.append(f"is_default = ${len(values)}")
            if payload.client_id is not None:
                values.extend([payload.client_id.strip(), settings.hmac_secret])
                updates.append(
                    f"client_id_enc = pgp_sym_encrypt(${len(values) - 1}, ${len(values)})"
                )
            if payload.api_key is not None:
                values.extend([payload.api_key.strip(), settings.hmac_secret])
                updates.append(f"api_key_enc = pgp_sym_encrypt(${len(values) - 1}, ${len(values)})")

            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update")

            values.extend([account_id, user["id"], settings.hmac_secret])
            query = f"""
                UPDATE admin_ozon_accounts
                SET {", ".join(updates)}, updated_at = NOW()
                WHERE id = ${len(values) - 2} AND user_id = ${len(values) - 1}
                RETURNING id, name, is_active, is_default, created_at, updated_at,
                    pgp_sym_decrypt(client_id_enc, ${len(values)}) AS client_id,
                    pgp_sym_decrypt(api_key_enc, ${len(values)}) AS api_key
            """
            row = await _safe_fetchone(conn, query, *values)

    if not row:
        raise HTTPException(status_code=404, detail="Ozon account not found")
    return {"item": OzonAccountView(**_ozon_account_view(dict(row)))}


@router.delete("/integrations/ozon/accounts/{account_id}", response_model=OkResponse)
async def delete_ozon_account(
    account_id: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, bool]:
    """Удаление Ozon-аккаунта."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await _safe_execute(
            conn,
            "DELETE FROM admin_ozon_accounts WHERE id = $1 AND user_id = $2",
            account_id,
            user["id"],
        )
    if result.endswith("0"):
        raise HTTPException(status_code=404, detail="Ozon account not found")
    return {"ok": True}
