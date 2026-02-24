"""PluginContext — controlled API for plugins to interact with core data."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

import asyncpg

logger = logging.getLogger(__name__)


class PluginPermissionError(Exception):
    pass


@dataclass
class PluginContext:
    plugin_name: str
    _pool_getter: Callable[[], asyncpg.Pool | None] = field(repr=False)

    @property
    def pool(self) -> asyncpg.Pool:
        p = self._pool_getter()
        if not p:
            raise RuntimeError("Database pool not available")
        return p

    async def enrich_card(
        self,
        card_id: str,
        user_id: str,
        source_key: str,
        kind: str,
        data: dict[str, Any],
        external_ref: str | None = None,
    ) -> dict[str, Any]:
        """Write enrichment to master_cards.attributes.sources (namespaced)."""
        prefix = f"{self.plugin_name}:"
        if not source_key.startswith(prefix):
            raise PluginPermissionError(
                f"Plugin '{self.plugin_name}' can only write source keys "
                f"starting with '{prefix}', got '{source_key}'"
            )

        from proxy.src.services.admin.card_service import merge_card_source

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT attributes FROM master_cards WHERE id = $1 AND user_id = $2",
                card_id,
                user_id,
            )
            if not row:
                raise ValueError(f"Card {card_id} not found for user {user_id}")

            current_attrs = row["attributes"]
            if isinstance(current_attrs, str):
                current_attrs = json.loads(current_attrs)

            new_attrs = merge_card_source(
                attributes=current_attrs,
                source_key=source_key,
                source_kind=kind,
                provider=self.plugin_name,
                external_ref=external_ref,
                data=data,
            )

            await conn.execute(
                "UPDATE master_cards SET attributes = $1, updated_at = NOW() "
                "WHERE id = $2 AND user_id = $3",
                json.dumps(new_attrs),
                card_id,
                user_id,
            )

        logger.info(
            "Plugin %s enriched card %s with source_key=%s kind=%s",
            self.plugin_name,
            card_id,
            source_key,
            kind,
        )
        return new_attrs

    async def read_card(self, card_id: str, user_id: str) -> dict[str, Any] | None:
        """Read a master card (scoped by user_id)."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM master_cards WHERE id = $1 AND user_id = $2",
                card_id,
                user_id,
            )
            if not row:
                return None
            result = dict(row)
            if isinstance(result.get("attributes"), str):
                result["attributes"] = json.loads(result["attributes"])
            return result

    async def get_plugin_conn(self) -> asyncpg.pool.PoolConnectionProxy:
        """Get a connection with search_path set to plugin schema."""
        conn = await self.pool.acquire()
        schema = f"plugin_{self.plugin_name}"
        await conn.execute(f"SET search_path TO {schema}, public")
        return conn
