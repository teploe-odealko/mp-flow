"""Health check endpoint."""

from fastapi import APIRouter, Request
from proxy.src.config import settings

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict:
    db_status: dict = {"configured": False, "status": "not_configured"}

    if settings.database_url:
        pool = getattr(request.app.state, "db_pool", None)
        if not pool:
            db_status = {"configured": True, "status": "pool_not_initialized"}
        else:
            try:
                async with pool.acquire() as conn:
                    await conn.fetchval("SELECT 1")
                db_status = {"configured": True, "status": "connected"}
            except Exception as e:
                db_status = {"configured": True, "status": "error", "error": str(e)}

    integrations = {
        "ozon": bool(settings.ozon_client_id and settings.ozon_api_key),
        "tmapi_1688": bool(settings.tmapi_api_token),
        "logto_sso": bool(settings.logto_endpoint),
    }

    db_ok = db_status.get("status") in ("connected", "not_configured")
    overall = "healthy" if db_ok else "degraded"

    return {
        "status": overall,
        "database": db_status,
        "integrations": integrations,
    }


@router.get("/health/simple")
async def health_simple() -> dict:
    return {"status": "ok"}
