from __future__ import annotations

import logging
import sys
import time
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from proxy.src.config import settings
from proxy.src.routes import admin, api_docs, health
from proxy.src.routes.admin.errors import (
    http_exception_to_problem,
    is_admin_request,
    validation_exception_to_problem,
)
from proxy.src.routes.api_docs import OPENAPI_DESCRIPTION, OPENAPI_TAGS
from proxy.src.services.exchange_rate import get_usd_rate

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:     %(name)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger(__name__)


async def create_pool() -> asyncpg.Pool | None:
    if not settings.database_url:
        return None
    return await asyncpg.create_pool(dsn=settings.database_url, min_size=1, max_size=5)


def create_app() -> FastAPI:
    app = FastAPI(
        title="MPFlow Admin API",
        version="1.0.0",
        description=OPENAPI_DESCRIPTION,
        openapi_tags=OPENAPI_TAGS,
        docs_url=None,
        redoc_url=None,
    )

    origins = settings.admin_cors_origins_list or [
        "https://admin.mp-flow.ru",
        "http://localhost:5173",
        "http://localhost:3000",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        logger.info("Application starting...")
        _app.state.db_pool = await create_pool()

        try:
            rate = await get_usd_rate()
            logger.info("Exchange rate loaded: %.2f RUB/USD", rate)
        except Exception as e:
            logger.warning("Could not fetch exchange rate: %s", e)

        # Initialize plugin schemas
        _plugins = getattr(_app.state, "_plugins", {})
        if _plugins and _app.state.db_pool:
            try:
                from proxy.src.plugins import ensure_plugin_schemas

                await ensure_plugin_schemas(_app.state.db_pool, _plugins)
                logger.info("Plugin schemas initialized for %d plugin(s)", len(_plugins))
            except Exception as e:
                logger.warning("Plugin schema init failed: %s", e)

        # Start MCP session manager
        _mcp_sm = getattr(_app.state, "_mcp_session_manager", None)
        if _mcp_sm:
            _mcp_ctx = _mcp_sm.run()
            await _mcp_ctx.__aenter__()
            logger.info("MCP session manager started")
        else:
            _mcp_ctx = None

        try:
            yield
        finally:
            if _mcp_ctx:
                await _mcp_ctx.__aexit__(None, None, None)
            pool = _app.state.db_pool
            if pool:
                await pool.close()

    app.router.lifespan_context = lifespan

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        if is_admin_request(request):
            return validation_exception_to_problem(request, exc)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": exc.errors()},
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        if is_admin_request(request):
            return http_exception_to_problem(request, exc)
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=exc.headers,
        )

    app.include_router(health.router)
    app.include_router(api_docs.router)

    # Plugin system
    try:
        from proxy.src.plugins import discover_plugins, mount_plugin_routes

        _plugins = discover_plugins()
        if _plugins:
            mount_plugin_routes(admin.router, _plugins, lambda: app.state.db_pool)
            logger.info("Loaded %d plugin(s): %s", len(_plugins), ", ".join(_plugins))
        app.state._plugins = _plugins

        @admin.router.get("/plugins")
        async def list_plugins():
            plugins_list = []
            for name, m in _plugins.items():
                plugins_list.append(
                    {
                        "name": name,
                        "version": m.get("version"),
                        "title": m.get("title"),
                        "description": m.get("description"),
                        "contributes": m.get("contributes", {}),
                        "provides_kinds": m.get("provides_kinds", []),
                        "frontend": m.get("frontend"),
                    }
                )
            return {"plugins": plugins_list}

    except Exception as e:
        logger.warning("Plugin system error: %s", e)
        app.state._plugins = {}

        @admin.router.get("/plugins")
        async def list_plugins_empty():
            return {"plugins": []}

    app.include_router(admin.router)

    # OAuth2 endpoints for MCP clients
    try:
        from proxy.src.mcp.oauth import router as mcp_oauth_router

        app.include_router(mcp_oauth_router, include_in_schema=False)
        logger.info("MCP OAuth endpoints registered")
    except ImportError as e:
        logger.info("MCP OAuth not available: %s", e)

    # Custom OpenAPI schema
    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        from fastapi.openapi.utils import get_openapi

        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
            tags=app.openapi_tags,
        )
        schema.setdefault("components", {})["securitySchemes"] = {
            "BearerToken": {
                "type": "http",
                "scheme": "bearer",
                "description": "Admin token (from POST /v1/admin/auth/login) "
                "or MCP API key (mpk_...)",
            }
        }
        schema["security"] = [{"BearerToken": []}]
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi

    # MCP server (Streamable HTTP at /mcp)
    _mcp_session_manager = None
    try:
        from proxy.src.mcp import create_mcp_app

        mcp_app, _mcp_session_manager, _mcp_auth = create_mcp_app(
            pool_getter=lambda: app.state.db_pool
        )
        from starlette.routing import Mount

        app.routes.append(Mount("/mcp", app=mcp_app))
        logger.info("MCP server mounted at /mcp")
    except ImportError as e:
        logger.info("MCP not available (install mcp[cli]): %s", e)
    app.state._mcp_session_manager = _mcp_session_manager

    @app.middleware("http")
    async def inject_db_pool(request, call_next):
        request.state.db_pool = app.state.db_pool
        return await call_next(request)

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start_time = time.time()
        response = await call_next(request)
        duration = time.time() - start_time
        log_msg = f"{request.method} {request.url.path} - {response.status_code} - {duration:.3f}s"
        if response.status_code >= 400:
            logger.error(log_msg)
        else:
            logger.info(log_msg)
        return response

    return app


app = create_app()
