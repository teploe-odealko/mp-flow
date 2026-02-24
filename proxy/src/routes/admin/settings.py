from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from proxy.src.routes.admin.deps import get_current_user, get_db_pool
from proxy.src.routes.admin.response_models import SettingsResponse
from proxy.src.routes.admin_helpers import _safe_execute, _safe_fetchone
from proxy.src.routes.admin_models import AdminSettingsUpdateRequest

router = APIRouter(tags=["Settings"])


@router.get("/license")
async def get_license_info() -> dict[str, Any]:
    """Current license status (no auth required — used by UI bootstrap)."""
    from proxy.src.ee import get_license_info, get_plan

    return {"plan": get_plan(), **get_license_info()}


@router.get("/settings", response_model=SettingsResponse)
async def get_admin_settings(
    request: Request,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Текущие настройки аккаунта (ставка УСН и др.)."""
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        row = await _safe_fetchone(
            conn,
            "SELECT usn_rate FROM admin_users WHERE id = $1",
            admin["id"],
        )
    return {"usn_rate": float(row["usn_rate"]) if row and row["usn_rate"] else 7.0}


@router.put("/settings", response_model=SettingsResponse)
async def update_admin_settings(
    request: Request,
    body: AdminSettingsUpdateRequest,
    admin: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Обновление настроек аккаунта (ставка УСН и др.)."""
    usn_rate = body.usn_rate
    pool = get_db_pool(request)
    async with pool.acquire() as conn:
        if usn_rate is not None:
            await _safe_execute(
                conn,
                "UPDATE admin_users SET usn_rate = $2 WHERE id = $1",
                admin["id"],
                usn_rate,
            )
    return {"usn_rate": usn_rate if usn_rate is not None else 7.0}
