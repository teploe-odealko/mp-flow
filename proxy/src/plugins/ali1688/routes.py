"""ali1688 plugin HTTP routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from proxy.src.plugins.context import PluginContext
from proxy.src.routes.admin.deps import get_current_user
from pydantic import BaseModel, Field


class EnrichRequest(BaseModel):
    url: str = Field(min_length=10, description="1688.com product URL")


def create_router(ctx: PluginContext) -> APIRouter:
    router = APIRouter(tags=["Plugin: ali1688"])

    @router.get("/preview")
    async def preview_item(
        url: str,
        user: dict[str, Any] = Depends(get_current_user),
    ):
        """Preview a 1688 product without saving enrichment."""
        from proxy.src.plugins.ali1688.service import preview

        try:
            data = await preview(url)
            return {"ok": True, "data": data}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to fetch 1688 data: {e}") from e

    @router.post("/enrich/{card_id}")
    async def enrich_item(
        card_id: str,
        payload: EnrichRequest,
        user: dict[str, Any] = Depends(get_current_user),
    ):
        """Enrich a master card with data from 1688.com."""
        from proxy.src.plugins.ali1688.service import enrich_card

        try:
            result = await enrich_card(
                card_id=card_id,
                url=payload.url,
                user_id=user["id"],
                ctx=ctx,
            )
            return result
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Enrichment failed: {e}") from e

    return router
