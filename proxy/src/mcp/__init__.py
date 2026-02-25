"""MCP server factory for MPFlow ERP.

Creates a FastMCP instance, registers all tools, and returns an ASGI app
wrapped with authentication middleware.
"""

from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any

from proxy.src.config import settings

logger = logging.getLogger(__name__)

_mcp_instance = None
_auth_context: ContextVar = ContextVar("mcp_auth_context", default=None)


def get_mcp():
    """Get or create the singleton FastMCP instance."""
    global _mcp_instance
    if _mcp_instance is None:
        from mcp.server.fastmcp import FastMCP

        transport_security = None
        try:
            # Parse hostname from BASE_URL for DNS rebinding protection
            from urllib.parse import urlparse

            from mcp.server.transport_security import TransportSecuritySettings

            host = urlparse(settings.base_url).hostname or "localhost"
            transport_security = TransportSecuritySettings(
                allowed_hosts=[host],
            )
        except ImportError:
            pass

        _mcp_instance = FastMCP(
            "MPFlow ERP",
            instructions=(
                "ERP-система продавца на маркетплейсе Ozon.\n\n"
                "Сущности: карточка (товар/SKU) → заказ поставщику → FIFO-лот "
                "(партия на складе) → продажа → прибыль.\n"
                "Lifecycle: Закупка 1688 → Заказ → Получение (FIFO) → Отгрузка Ozon → "
                "Продажа → FIFO-списание.\n\n"
                "Ozon: данные синхронизируются через ozon_sync_* tools. "
                "Любой Ozon API endpoint доступен через ozon_api(path, body).\n"
                "Финансы: себестоимость по FIFO, P&L = выручка - COGS - комиссии Ozon - налог УСН.\n"
                "Ценообразование: pricing_calculate() — полный расчёт от закупки CNY "
                "до чистой прибыли RUB.\n\n"
                "Tools имеют префикс домена: catalog_*, orders_*, finance_*, reports_*, "
                "ozon_*, logistics_*, demand_*, media_*, meta_*."
            ),
            stateless_http=True,
            json_response=True,
            streamable_http_path="/",
            transport_security=transport_security,
        )
    return _mcp_instance


def _init_mcpauth():
    """Initialize mcpauth for Logto OIDC.

    Returns (mcp_auth, verify_fn) or (None, None) if unavailable.
    """
    if not settings.logto_endpoint:
        return None, None

    try:
        import requests as sync_requests
        from mcpauth import MCPAuth
        from mcpauth.config import AuthServerType
        from mcpauth.types import AuthInfo
        from mcpauth.utils import fetch_server_config

        auth_server_config = fetch_server_config(
            f"{settings.logto_endpoint}/oidc",
            type=AuthServerType.OIDC,
        )
        mcp_auth = MCPAuth(server=auth_server_config, context_var=_auth_context)

        def verify_access_token(token: str) -> AuthInfo:
            endpoint = auth_server_config.metadata.userinfo_endpoint
            response = sync_requests.get(
                endpoint,
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            data = response.json()
            return AuthInfo(
                token=token,
                subject=data.get("sub"),
                issuer=auth_server_config.metadata.issuer,
                claims=data,
            )

        logger.info("mcpauth initialized with Logto at %s", settings.logto_endpoint)
        return mcp_auth, verify_access_token

    except Exception as e:
        logger.warning("mcpauth init failed (falling back to mpk_ only): %s", e)
        return None, None


def create_mcp_app(pool_getter: Any) -> tuple[Any, Any, Any]:
    """Create the MCP ASGI app with auth middleware."""
    mcp = get_mcp()

    import proxy.src.mcp.tools  # noqa: F401

    logger.info("MCP server created with %d tools", len(mcp._tool_manager.list_tools()))

    mcp_asgi = mcp.streamable_http_app()
    mcp_auth, verify_fn = _init_mcpauth()

    from proxy.src.mcp.auth import McpAuthMiddleware

    wrapped = McpAuthMiddleware(
        mcp_asgi,
        pool_getter,
        verify_jwt_fn=verify_fn,
        auth_context=_auth_context,
    )

    return wrapped, mcp._session_manager, mcp_auth
