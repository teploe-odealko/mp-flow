from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from proxy.src.routes.admin.deps import get_db_pool, require_admin
from proxy.src.routes.admin.response_models import UserItemResponse, UsersListResponse
from proxy.src.services.admin import auth_service
from pydantic import BaseModel, Field

router = APIRouter(tags=["Users"])


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=4, max_length=200)
    full_name: str | None = Field(default=None, max_length=255)
    is_admin: bool = False
    is_active: bool = True


class UpdateUserRequest(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=4, max_length=200)
    is_admin: bool | None = None
    is_active: bool | None = None


@router.get("/users", response_model=UsersListResponse)
async def list_users(
    request: Request,
    _: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Список всех пользователей (только для администраторов)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await auth_service.list_users(conn)


@router.post("/users", response_model=UserItemResponse)
async def create_user(
    payload: CreateUserRequest,
    request: Request,
    _: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Создание нового пользователя (только для администраторов)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await auth_service.create_user(
            conn,
            username=payload.username,
            password=payload.password,
            full_name=payload.full_name,
            is_admin=payload.is_admin,
            is_active=payload.is_active,
        )


@router.patch("/users/{user_id}", response_model=UserItemResponse)
async def update_user(
    user_id: str,
    payload: UpdateUserRequest,
    request: Request,
    current_admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Обновление пользователя (пароль, имя, роль, статус)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        return await auth_service.update_user(
            conn,
            user_id=user_id,
            current_user_id=str(current_admin["id"]),
            full_name=payload.full_name,
            password=payload.password,
            is_admin=payload.is_admin,
            is_active=payload.is_active,
        )
