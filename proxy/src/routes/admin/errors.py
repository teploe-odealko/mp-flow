from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

PROBLEM_MEDIA_TYPE = "application/problem+json"

_STATUS_TITLES: dict[int, str] = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
    503: "Service Unavailable",
}

_STATUS_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    422: "validation_error",
    500: "internal_error",
    503: "service_unavailable",
}


def is_admin_request(request: Request) -> bool:
    return request.url.path.startswith("/v1/admin")


def _utc_now_rfc3339() -> str:
    return datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _problem_payload(
    *,
    request: Request,
    status_code: int,
    title: str,
    detail: str | None,
    error_code: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type": f"https://docs.mp-flow.ru/problems/{error_code}",
        "title": title,
        "status": status_code,
        "detail": detail or title,
        "instance": str(request.url.path),
        "error_code": error_code,
        "timestamp": _utc_now_rfc3339(),
    }
    if extra:
        payload.update(extra)
    return payload


def problem_response(
    *,
    request: Request,
    status_code: int,
    title: str,
    detail: str | None,
    error_code: str,
    extra: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=_problem_payload(
            request=request,
            status_code=status_code,
            title=title,
            detail=detail,
            error_code=error_code,
            extra=extra,
        ),
        media_type=PROBLEM_MEDIA_TYPE,
        headers=headers,
    )


def http_exception_to_problem(request: Request, exc: HTTPException) -> JSONResponse:
    detail: str
    extra: dict[str, Any] | None = None
    if isinstance(exc.detail, str):
        detail = exc.detail
    else:
        detail = "Request failed"
        extra = {"detail_payload": exc.detail}

    status_code = int(exc.status_code)
    return problem_response(
        request=request,
        status_code=status_code,
        title=_STATUS_TITLES.get(status_code, "Request Failed"),
        detail=detail,
        error_code=_STATUS_CODES.get(status_code, "request_failed"),
        extra=extra,
        headers=dict(exc.headers) if exc.headers else None,
    )


def validation_exception_to_problem(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    return problem_response(
        request=request,
        status_code=422,
        title="Validation Error",
        detail="Request body or query params failed validation",
        error_code="validation_error",
        extra={"invalid_params": exc.errors()},
    )
