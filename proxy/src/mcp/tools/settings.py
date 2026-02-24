from proxy.src.mcp import get_mcp
from proxy.src.mcp.deps import get_deps
from proxy.src.mcp.errors import mcp_error_handler, serialize_result
from proxy.src.repositories.admin.base import safe_execute, safe_fetchone

mcp = get_mcp()


@mcp.tool()
@mcp_error_handler
async def settings_get() -> str:
    """Get user settings (currently: USN tax rate)."""
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        row = await safe_fetchone(
            conn,
            "SELECT usn_rate FROM admin_users WHERE id = $1",
            deps.user_id,
        )
    usn_rate = float(row["usn_rate"]) if row and row["usn_rate"] else 7.0
    return serialize_result({"usn_rate": usn_rate})


@mcp.tool()
@mcp_error_handler
async def settings_update(usn_rate: float) -> str:
    """Update user settings.

    Args:
        usn_rate: USN tax rate as percentage (e.g. 7.0 for 7%).
    """
    deps = get_deps()
    async with deps.pool.acquire() as conn:
        await safe_execute(
            conn,
            "UPDATE admin_users SET usn_rate = $2 WHERE id = $1",
            deps.user_id,
            usn_rate,
        )
    return serialize_result({"usn_rate": usn_rate})
