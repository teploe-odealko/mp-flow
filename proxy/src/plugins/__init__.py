"""Plugin discovery, loading, and lifecycle management."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import asyncpg
from fastapi import APIRouter

logger = logging.getLogger(__name__)

PLUGINS_DIR = Path(__file__).parent


def discover_plugins() -> dict[str, dict[str, Any]]:
    """Scan proxy/src/plugins/*/manifest.json and return {name: manifest}."""
    plugins: dict[str, dict[str, Any]] = {}
    for manifest_path in sorted(PLUGINS_DIR.glob("*/manifest.json")):
        try:
            manifest = json.loads(manifest_path.read_text())
            name = manifest.get("name")
            if not name:
                logger.warning("Plugin manifest missing 'name': %s", manifest_path)
                continue
            manifest["_dir"] = str(manifest_path.parent)
            plugins[name] = manifest
            logger.info("Discovered plugin: %s v%s", name, manifest.get("version", "?"))
        except Exception as e:
            logger.error("Failed to load plugin manifest %s: %s", manifest_path, e)
    return plugins


async def ensure_plugin_schemas(pool: asyncpg.Pool, plugins: dict[str, dict[str, Any]]) -> None:
    """Create isolated PostgreSQL schemas for each plugin and run schema.sql."""
    async with pool.acquire() as conn:
        for name, manifest in plugins.items():
            schema_name = f"plugin_{name}"
            await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_name}")
            logger.info("Ensured schema: %s", schema_name)

            schema_file = Path(manifest["_dir"]) / "schema.sql"
            if schema_file.exists():
                sql = schema_file.read_text()
                if sql.strip():
                    await conn.execute(f"SET search_path TO {schema_name}, public")
                    await conn.execute(sql)
                    await conn.execute("SET search_path TO public")
                    logger.info("Applied schema.sql for plugin %s", name)


def mount_plugin_routes(
    app_router: APIRouter,
    plugins: dict[str, dict[str, Any]],
    pool_getter,
) -> None:
    """Import and mount plugin backend routes."""
    from proxy.src.plugins.context import PluginContext

    for name, manifest in plugins.items():
        backend = manifest.get("backend")
        if not backend:
            continue
        api_prefix = backend.get("apiPrefix", name)
        plugin_dir = Path(manifest["_dir"])
        routes_file = plugin_dir / "routes.py"
        if not routes_file.exists():
            logger.warning("Plugin %s declares backend but has no routes.py", name)
            continue

        try:
            import importlib.util

            spec = importlib.util.spec_from_file_location(
                f"proxy.src.plugins.{name}.routes", str(routes_file)
            )
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            if hasattr(mod, "create_router"):
                ctx = PluginContext(plugin_name=name, _pool_getter=pool_getter)
                router = mod.create_router(ctx)
                app_router.include_router(router, prefix=f"/plugins/{api_prefix}")
                logger.info("Mounted plugin routes: /v1/admin/plugins/%s", api_prefix)
            elif hasattr(mod, "router"):
                app_router.include_router(mod.router, prefix=f"/plugins/{api_prefix}")
                logger.info("Mounted plugin routes: /v1/admin/plugins/%s", api_prefix)
        except Exception as e:
            logger.error("Failed to mount routes for plugin %s: %s", name, e)
