from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.response_models import (
    ApiKeyCreateResponse,
    ApiKeyView,
    ApiKeysListResponse,
)
from proxy.src.services.admin import api_key_service

router = APIRouter(prefix="/api-keys", tags=["API Keys"])


@router.get("", response_model=ApiKeysListResponse)
async def list_api_keys(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Список API-ключей текущего пользователя."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await api_key_service.list_keys(conn, user_id=user["id"])


@router.post("", status_code=201, response_model=ApiKeyCreateResponse)
async def create_api_key(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Создание нового API-ключа. Ключ показывается только один раз."""
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="name is required")
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await api_key_service.create_key(conn, user_id=user["id"], name=name)


@router.delete("/{key_id}", response_model=ApiKeyView)
async def revoke_api_key(
    key_id: str,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Отзыв (деактивация) API-ключа."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await api_key_service.revoke_key(conn, key_id=key_id, user_id=user["id"])
