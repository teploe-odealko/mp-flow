"""Base numeric utilities used across admin services."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

MONEY_QUANT = Decimal("0.01")
QTY_QUANT = Decimal("0.001")
EPSILON = Decimal("0.000001")


def to_money(value: Any) -> Decimal:
    """Normalize a numeric-like value to money with 2 digits."""
    if isinstance(value, Decimal):
        return value.quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    try:
        return Decimal(str(value or 0)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def to_qty(value: Any) -> Decimal:
    """Normalize quantity to 3 decimal digits."""
    if isinstance(value, Decimal):
        return value.quantize(QTY_QUANT, rounding=ROUND_HALF_UP)
    try:
        return Decimal(str(value or 0)).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.000")
