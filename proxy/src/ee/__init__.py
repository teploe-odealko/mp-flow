"""OpenMPFlow Enterprise Edition — feature gating and license validation.

Usage in route handlers:

    from proxy.src.ee import is_premium, require_premium

    # Check if premium is active
    if is_premium():
        ...premium logic...

    # Or guard an entire endpoint
    @router.get("/advanced-report")
    async def advanced_report():
        require_premium("advanced_reports")
        ...
"""

from __future__ import annotations

from fastapi import HTTPException
from proxy.src.ee.license import LicenseManager

_manager: LicenseManager | None = None


def _get_manager() -> LicenseManager:
    global _manager
    if _manager is None:
        _manager = LicenseManager()
    return _manager


def is_premium() -> bool:
    """Return True if a valid premium license is active."""
    return _get_manager().is_valid()


def get_plan() -> str:
    """Return current plan: 'community', 'pro', or 'enterprise'."""
    return _get_manager().plan()


def get_license_info() -> dict:
    """Return license metadata (org, plan, expiry) or empty dict."""
    return _get_manager().info()


def require_premium(feature: str) -> None:
    """Raise 403 if no valid premium license. Use as a route guard."""
    if not is_premium():
        raise HTTPException(
            status_code=403,
            detail={
                "error": "premium_required",
                "feature": feature,
                "message": f"Feature '{feature}' requires a premium license. "
                "See https://mp-flow.ru/pricing",
            },
        )
