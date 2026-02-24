# Import all tool modules to trigger @mcp.tool() registration.
# Each module imports `mcp` from proxy.src.mcp and registers tools on it.

from proxy.src.mcp.tools import (
    catalog,  # noqa: F401
    demand,  # noqa: F401
    finance,  # noqa: F401
    integrations,  # noqa: F401
    inventory,  # noqa: F401
    logistics,  # noqa: F401
    media,  # noqa: F401
    meta,  # noqa: F401
    orders,  # noqa: F401
    ozon,  # noqa: F401
    reports,  # noqa: F401
    sales,  # noqa: F401
    settings,  # noqa: F401
)
