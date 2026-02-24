"""Error handling for MCP tools.

Wraps tool functions to catch HTTPException and return MCP-compatible error responses.
"""

from __future__ import annotations

import json
import logging
from functools import wraps
from typing import Any, Callable

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def serialize_result(data: Any) -> str:
    """Serialize tool result to JSON string."""
    return json.dumps(data, default=str, ensure_ascii=False)


def mcp_error_handler(fn: Callable) -> Callable:
    """Decorator: catches exceptions and returns MCP-friendly error dicts."""

    @wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> str:
        try:
            result = await fn(*args, **kwargs)
            if isinstance(result, str):
                return result
            return serialize_result(result)
        except HTTPException as exc:
            logger.warning(
                "MCP tool %s HTTPException %d: %s", fn.__name__, exc.status_code, exc.detail
            )
            return serialize_result({"error": exc.detail, "status": exc.status_code})
        except Exception as exc:
            logger.exception("MCP tool %s unexpected error", fn.__name__)
            return serialize_result({"error": str(exc), "status": 500})

    return wrapper
