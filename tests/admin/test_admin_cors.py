from __future__ import annotations

from fastapi.middleware.cors import CORSMiddleware

from proxy.src.config import settings
from proxy.src.main import create_app


def _cors_middleware_kwargs() -> dict:
    app = create_app()
    cors = next((mw for mw in app.user_middleware if mw.cls is CORSMiddleware), None)
    assert cors is not None, "CORS middleware must be configured for admin frontend"
    return dict(cors.kwargs)


def test_admin_cors_defaults_include_production_admin_origin() -> None:
    old_value = settings.admin_cors_origins
    settings.admin_cors_origins = None
    try:
        kwargs = _cors_middleware_kwargs()
    finally:
        settings.admin_cors_origins = old_value

    assert "https://admin.mp-flow.ru" in kwargs["allow_origins"]
    assert "http://localhost:5173" in kwargs["allow_origins"]
    assert kwargs["allow_methods"] == ["*"]
    assert kwargs["allow_headers"] == ["*"]


def test_admin_cors_uses_explicit_env_value_when_provided() -> None:
    old_value = settings.admin_cors_origins
    settings.admin_cors_origins = "https://foo.example,https://bar.example"
    try:
        kwargs = _cors_middleware_kwargs()
    finally:
        settings.admin_cors_origins = old_value

    assert kwargs["allow_origins"] == ["https://foo.example", "https://bar.example"]
