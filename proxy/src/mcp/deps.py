"""MCP dependency injection via ContextVar.

The auth middleware sets McpDeps before each MCP request.
Tool handlers read it via get_deps().
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass

import asyncpg

_mcp_deps: ContextVar[McpDeps | None] = ContextVar("mcp_deps", default=None)


@dataclass(slots=True)
class McpDeps:
    pool: asyncpg.Pool
    user_id: str


def set_deps(deps: McpDeps) -> None:
    _mcp_deps.set(deps)


def get_deps() -> McpDeps:
    deps = _mcp_deps.get()
    if deps is None:
        raise RuntimeError("MCP deps not set — request not authenticated")
    return deps
