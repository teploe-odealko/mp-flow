"""ali1688 plugin service — unified handlers for HTTP and MCP."""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from proxy.src.plugins.context import PluginContext
from proxy.src.services.admin.tmapi_client import fetch_1688_item, parse_tmapi_1688_item

logger = logging.getLogger(__name__)


async def preview(url: str) -> dict[str, Any]:
    """Fetch and parse a 1688 product page. Returns normalized data."""
    raw = await fetch_1688_item(url)
    return parse_tmapi_1688_item(raw)


async def enrich_card(
    card_id: str,
    url: str,
    user_id: str,
    ctx: PluginContext,
) -> dict[str, Any]:
    """Fetch 1688 data and write enrichment to the card."""
    data = await preview(url)
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    source_key = f"ali1688:{url_hash}"

    # Strip raw payload from enrichment data (too large for attributes)
    enrichment_data = {k: v for k, v in data.items() if k != "raw"}

    await ctx.enrich_card(
        card_id=card_id,
        user_id=user_id,
        source_key=source_key,
        kind="supplier",
        data=enrichment_data,
    )

    logger.info("Enriched card %s from 1688 URL %s", card_id, url)
    return {"ok": True, "source_key": source_key, "data": enrichment_data}
