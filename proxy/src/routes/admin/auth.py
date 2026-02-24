from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from proxy.src.config import settings
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.response_models import LoginResponse, MeResponse, OkResponse
from proxy.src.services.admin import auth_service
from pydantic import BaseModel, Field

router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=4, max_length=200)


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    """Аутентификация по логину и паролю. Возвращает Bearer token и устанавливает cookie."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        result = await auth_service.authenticate(
            conn, username=payload.username, password=payload.password
        )

    response.set_cookie(
        key="admin_token",
        value=result["access_token"],
        max_age=auth_service.token_ttl_seconds(),
        httponly=True,
        secure=(request.url.scheme == "https"),
        samesite="lax",
        path="/v1/admin",
    )
    return result


@router.post("/logout", response_model=OkResponse)
async def logout(response: Response) -> dict[str, bool]:
    """Завершение сессии. Удаляет cookie с токеном."""
    response.delete_cookie(key="admin_token", path="/v1/admin")
    return {"ok": True}


@router.get("/config")
async def auth_config() -> dict[str, Any]:
    """Returns auth configuration for the frontend (no auth required)."""
    if settings.logto_endpoint and settings.logto_spa_app_id:
        return {
            "mode": "logto",
            "logto_endpoint": settings.logto_endpoint,
            "logto_app_id": settings.logto_spa_app_id,
            "logto_api_resource": settings.logto_api_resource or "",
        }
    return {"mode": "password"}


@router.get("/me", response_model=MeResponse)
async def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Информация о текущем аутентифицированном пользователе."""
    return {"user": user}
