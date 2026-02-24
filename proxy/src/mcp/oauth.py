"""OAuth2 discovery + RFC 7591 DCR + OAuth proxy for MCP.

Serves:
  - /.well-known/oauth-protected-resource  (RFC 9728)
  - /.well-known/oauth-authorization-server (RFC 8414)
  - POST /oauth/register                   (RFC 7591 DCR)
  - GET  /oauth/authorize                  (proxy -> Logto authorize)
  - POST /oauth/token                      (proxy -> Logto token)

All OAuth endpoints live on your domain. /oauth/authorize and /oauth/token
are proxied to the configured Logto instance.
"""

from __future__ import annotations

import logging
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse
from proxy.src.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(include_in_schema=False)


def _base_url() -> str:
    return settings.base_url


def _logto_oidc(path: str) -> str:
    return f"{settings.logto_endpoint}/oidc{path}"


def _build_as_metadata() -> dict:
    base = _base_url()
    return {
        "issuer": _logto_oidc(""),
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "revocation_endpoint": _logto_oidc("/token/revocation"),
        "jwks_uri": _logto_oidc("/jwks"),
        "scopes_supported": ["openid", "profile", "email"],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }


@router.get("/.well-known/oauth-protected-resource")
async def protected_resource_metadata() -> JSONResponse:
    base = _base_url()
    return JSONResponse(
        {
            "resource": f"{base}/mcp",
            "authorization_servers": [base],
            "bearer_methods_supported": ["header"],
            "scopes_supported": ["openid", "profile", "email"],
        }
    )


@router.get("/.well-known/oauth-authorization-server")
async def oauth_authorization_server() -> JSONResponse:
    return JSONResponse(_build_as_metadata())


@router.get("/.well-known/openid-configuration")
async def openid_configuration() -> JSONResponse:
    return JSONResponse(_build_as_metadata())


@router.get("/oauth/authorize")
async def authorize_proxy(request: Request) -> RedirectResponse:
    params = dict(request.query_params)

    scope = params.get("scope", "")
    scopes = set(scope.split()) if scope else set()
    scopes.add("openid")
    params["scope"] = " ".join(sorted(scopes))

    if "resource" in params and settings.logto_api_resource:
        params["resource"] = settings.logto_api_resource

    logto_url = _logto_oidc("/auth") + "?" + urlencode(params)
    logger.info(
        "OAuth authorize: redirecting to Logto (client_id=%s, scope=%s)",
        params.get("client_id"),
        params["scope"],
    )
    return RedirectResponse(url=logto_url, status_code=302)


@router.post("/oauth/token")
async def token_proxy(request: Request) -> JSONResponse:
    body_bytes = await request.body()
    content_type = request.headers.get("content-type", "application/x-www-form-urlencoded")

    if (
        b"resource=" in body_bytes
        and content_type.startswith("application/x-www-form-urlencoded")
        and settings.logto_api_resource
    ):
        from urllib.parse import parse_qs
        from urllib.parse import urlencode as ue

        parsed = parse_qs(body_bytes.decode("utf-8"), keep_blank_values=True)
        if "resource" in parsed:
            parsed["resource"] = [settings.logto_api_resource]
        body_bytes = ue({k: v[0] for k, v in parsed.items()}, doseq=False).encode("utf-8")

    headers = {"content-type": content_type}
    if "authorization" in request.headers:
        headers["authorization"] = request.headers["authorization"]

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(_logto_oidc("/token"), content=body_bytes, headers=headers)

    logger.info("OAuth token: Logto returned %d", resp.status_code)
    return JSONResponse(content=resp.json(), status_code=resp.status_code)


@router.post("/oauth/register")
async def register_client(request: Request) -> JSONResponse:
    mcp_client_id = settings.logto_mcp_client_id
    if not mcp_client_id:
        return JSONResponse(
            {
                "error": "server_error",
                "error_description": "Dynamic client registration is not configured. "
                "Set LOGTO_MCP_CLIENT_ID env var.",
            },
            status_code=500,
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "Invalid JSON body"},
            status_code=400,
        )

    client_name = body.get("client_name", "MCP Client")
    redirect_uris = body.get("redirect_uris", [])
    grant_types = body.get("grant_types", ["authorization_code"])
    response_types = body.get("response_types", ["code"])
    token_endpoint_auth_method = body.get("token_endpoint_auth_method", "none")

    return JSONResponse(
        {
            "client_id": mcp_client_id,
            "client_name": client_name,
            "redirect_uris": redirect_uris,
            "grant_types": grant_types,
            "response_types": response_types,
            "token_endpoint_auth_method": token_endpoint_auth_method,
            "scope": "openid profile email",
            "client_id_issued_at": int(time.time()),
            "client_secret_expires_at": 0,
        },
        status_code=201,
    )
