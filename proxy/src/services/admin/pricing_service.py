"""Pricing calculator: from CNY purchase price to final RUB profit.

Two modes:
1. Forward: given sale_price_rub → calculate margin
2. Reverse: given target_margin_pct → calculate required sale price

Also: calculate_breakeven() — simplified breakeven with tiered commission support.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any


def _d(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def _r2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_pricing(
    *,
    # Purchase
    purchase_price_cny: float,
    cny_rate: float,
    quantity: int = 1,
    # Per-unit logistics
    logistics_per_unit: float = 0,
    packaging_per_unit: float = 0,
    customs_per_unit: float = 0,
    extra_per_unit: float = 0,
    # Ozon fees (as percentages of sale price)
    commission_pct: float = 0,
    acquiring_pct: float = 1.5,
    # Ozon fixed fees per unit
    last_mile_rub: float = 0,
    storage_per_day_rub: float = 0,
    storage_days: int = 30,
    # Returns
    return_rate_pct: float = 0,
    return_logistics_rub: float = 0,
    # Tax
    usn_rate_pct: float = 7,
    # Either sale_price_rub OR target_margin_pct
    sale_price_rub: float | None = None,
    target_margin_pct: float | None = None,
) -> dict[str, Any]:
    """Calculate full pricing breakdown.

    Returns dict with: sale_price_rub, breakdown, per_unit, per_batch.
    """
    # --- COGS per unit ---
    purchase_rub = _r2(_d(purchase_price_cny) * _d(cny_rate))
    logistics = _r2(_d(logistics_per_unit))
    packaging = _r2(_d(packaging_per_unit))
    customs = _r2(_d(customs_per_unit))
    extra = _r2(_d(extra_per_unit))
    cogs_per_unit = purchase_rub + logistics + packaging + customs + extra

    # --- Storage ---
    storage_total = _r2(_d(storage_per_day_rub) * _d(storage_days))

    # --- Return cost per unit (amortized across all units) ---
    return_rate = _d(return_rate_pct) / 100
    return_cost_per_unit = _r2(_d(return_logistics_rub) * return_rate)

    # --- Mode selection ---
    comm_rate = _d(commission_pct) / 100
    acq_rate = _d(acquiring_pct) / 100
    usn_rate = _d(usn_rate_pct) / 100

    if sale_price_rub is not None:
        # Forward mode: calculate margin from given sale price
        sp = _d(sale_price_rub)
    elif target_margin_pct is not None:
        # Reverse mode: calculate sale price from target margin
        # profit = sp - cogs - sp*comm - sp*acq - last_mile - storage - return_cost - sp*usn
        # profit = sp * margin
        # sp * margin = sp - cogs - sp*comm - sp*acq - last_mile - storage - return_cost - sp*usn
        # sp * (margin - 1 + comm + acq + usn) = -(cogs + last_mile + storage + return_cost)
        # sp = (cogs + last_mile + storage + return_cost) / (1 - margin - comm - acq - usn)
        margin = _d(target_margin_pct) / 100
        denominator = 1 - margin - comm_rate - acq_rate - usn_rate
        if denominator <= 0:
            return {"error": "Target margin is too high — no valid sale price exists"}
        numerator = cogs_per_unit + _d(last_mile_rub) + storage_total + return_cost_per_unit
        sp = _r2(numerator / denominator)
    else:
        return {"error": "Provide either sale_price_rub or target_margin_pct"}

    # --- Ozon fees ---
    commission_rub = _r2(sp * comm_rate)
    acquiring_rub = _r2(sp * acq_rate)
    last_mile = _r2(_d(last_mile_rub))

    # --- Tax ---
    tax_rub = _r2(sp * usn_rate)

    # --- Per unit P&L ---
    total_costs = (
        cogs_per_unit
        + commission_rub
        + acquiring_rub
        + last_mile
        + storage_total
        + return_cost_per_unit
        + tax_rub
    )
    profit_per_unit = _r2(sp - total_costs)
    margin_pct = _r2(profit_per_unit / sp * 100) if sp > 0 else Decimal(0)

    # --- Per batch ---
    qty = _d(quantity)
    investment = _r2(cogs_per_unit * qty)
    batch_revenue = _r2(sp * qty)
    batch_profit = _r2(profit_per_unit * qty)
    roi_pct = _r2(batch_profit / investment * 100) if investment > 0 else Decimal(0)

    return {
        "sale_price_rub": float(sp),
        "breakdown": {
            "cogs": {
                "purchase_rub": float(purchase_rub),
                "purchase_cny": purchase_price_cny,
                "cny_rate": cny_rate,
                "logistics": float(logistics),
                "packaging": float(packaging),
                "customs": float(customs),
                "extra": float(extra),
                "total_cogs": float(cogs_per_unit),
            },
            "ozon_fees": {
                "commission_rub": float(commission_rub),
                "commission_pct": commission_pct,
                "acquiring_rub": float(acquiring_rub),
                "acquiring_pct": acquiring_pct,
                "last_mile_rub": float(last_mile),
                "storage_rub": float(storage_total),
                "storage_days": storage_days,
            },
            "return_cost_rub": float(return_cost_per_unit),
            "return_rate_pct": return_rate_pct,
            "tax_rub": float(tax_rub),
            "usn_rate_pct": usn_rate_pct,
        },
        "per_unit": {
            "revenue": float(sp),
            "total_costs": float(total_costs),
            "profit": float(profit_per_unit),
            "margin_pct": float(margin_pct),
        },
        "per_batch": {
            "quantity": quantity,
            "investment": float(investment),
            "revenue": float(batch_revenue),
            "profit": float(batch_profit),
            "roi_pct": float(roi_pct),
        },
    }


# ---------------------------------------------------------------------------
# Breakeven calculator with tiered commission support
# ---------------------------------------------------------------------------


def _resolve_commission(price: float, tiers: list[dict]) -> float:
    """Find commission rate for a given price from sorted tiers."""
    for t in tiers:
        if price >= t["price_min"] and (t["price_max"] is None or price < t["price_max"]):
            return float(t["rate"])
    # Fallback: last tier
    return float(tiers[-1]["rate"]) if tiers else 0


def _calc_breakeven_single(
    *,
    cogs_rub: float,
    commission_pct: float,
    acquiring_pct: float = 1.5,
    last_mile_rub: float = 63.0,
    storage_per_day_rub: float = 0,
    storage_days: int = 30,
    return_rate_pct: float = 5.0,
    return_logistics_rub: float = 50.0,
    usn_rate_pct: float = 7.0,
    target_margin_pct: float = 0,
) -> dict[str, Any]:
    """Compute sale price for a target margin given costs and commission %."""
    cogs = _d(cogs_rub)
    comm = _d(commission_pct) / 100
    acq = _d(acquiring_pct) / 100
    usn = _d(usn_rate_pct) / 100
    margin = _d(target_margin_pct) / 100
    lm = _d(last_mile_rub)
    storage = _r2(_d(storage_per_day_rub) * _d(storage_days))
    ret_cost = _r2(_d(return_logistics_rub) * _d(return_rate_pct) / 100)

    denom = 1 - margin - comm - acq - usn
    if denom <= 0:
        return {"error": "Target margin is too high", "target_margin_pct": target_margin_pct}

    fixed_costs = cogs + lm + storage + ret_cost
    sp = _r2(fixed_costs / denom)

    commission_rub = _r2(sp * comm)
    acquiring_rub = _r2(sp * acq)
    tax_rub = _r2(sp * usn)
    total_costs = cogs + commission_rub + acquiring_rub + lm + storage + ret_cost + tax_rub
    profit = _r2(sp - total_costs)
    actual_margin = _r2(profit / sp * 100) if sp > 0 else Decimal(0)

    return {
        "sale_price_rub": float(sp),
        "target_margin_pct": target_margin_pct,
        "actual_margin_pct": float(actual_margin),
        "breakdown": {
            "cogs_rub": float(cogs),
            "commission_rub": float(commission_rub),
            "commission_pct": commission_pct,
            "acquiring_rub": float(acquiring_rub),
            "acquiring_pct": acquiring_pct,
            "last_mile_rub": float(lm),
            "storage_rub": float(storage),
            "return_cost_rub": float(ret_cost),
            "return_rate_pct": return_rate_pct,
            "tax_rub": float(tax_rub),
            "usn_rate_pct": usn_rate_pct,
            "total_costs": float(total_costs),
        },
        "profit_rub": float(profit),
    }


def calculate_breakeven(
    *,
    cogs_rub: float,
    commission_pct: float | None = None,
    commission_tiers: list[dict] | None = None,
    acquiring_pct: float = 1.5,
    last_mile_rub: float = 63.0,
    storage_per_day_rub: float = 0,
    storage_days: int = 30,
    return_rate_pct: float = 5.0,
    return_logistics_rub: float = 50.0,
    usn_rate_pct: float = 7.0,
    sale_price_rub: float | None = None,
    target_margin_pct: float | None = None,
    margin_targets: list[float] | None = None,
) -> dict[str, Any]:
    """Calculate breakeven with optional tiered commission and multi-margin.

    If commission_tiers is provided (and commission_pct is not), iteratively
    resolve the commission rate based on the computed price — converges in 2-3 steps.

    If margin_targets is provided, returns results for each target margin.
    """
    common = dict(
        cogs_rub=cogs_rub,
        acquiring_pct=acquiring_pct,
        last_mile_rub=last_mile_rub,
        storage_per_day_rub=storage_per_day_rub,
        storage_days=storage_days,
        return_rate_pct=return_rate_pct,
        return_logistics_rub=return_logistics_rub,
        usn_rate_pct=usn_rate_pct,
    )

    def _resolve_comm_for_margin(target_margin: float) -> float:
        """Iteratively resolve commission for a target margin with tiered rates."""
        if commission_pct is not None:
            return commission_pct
        if not commission_tiers:
            return 0
        # Start with mid-range tier
        comm = _resolve_commission(1000, commission_tiers) * 100  # as pct
        for _ in range(5):
            result = _calc_breakeven_single(commission_pct=comm, target_margin_pct=target_margin, **common)
            if "error" in result:
                return comm
            price = result["sale_price_rub"]
            new_comm = _resolve_commission(price, commission_tiers) * 100
            if abs(new_comm - comm) < 0.01:
                break
            comm = new_comm
        return comm

    # Forward mode: given sale_price_rub
    if sale_price_rub is not None:
        comm = commission_pct if commission_pct is not None else (
            _resolve_commission(sale_price_rub, commission_tiers) * 100 if commission_tiers else 0
        )
        result = _calc_breakeven_single(commission_pct=comm, target_margin_pct=0, **common)
        # Recalc as forward: compute actual margin at given sale price
        sp = _d(sale_price_rub)
        b = result["breakdown"]
        comm_rub = _r2(sp * _d(comm) / 100)
        acq_rub = _r2(sp * _d(acquiring_pct) / 100)
        tax_rub = _r2(sp * _d(usn_rate_pct) / 100)
        total = _d(cogs_rub) + comm_rub + acq_rub + _d(b["last_mile_rub"]) + _d(b["storage_rub"]) + _d(b["return_cost_rub"]) + tax_rub
        profit = _r2(sp - total)
        margin = _r2(profit / sp * 100) if sp > 0 else Decimal(0)
        return {
            "sale_price_rub": float(sp),
            "breakeven_price_rub": result["sale_price_rub"],
            "actual_margin_pct": float(margin),
            "profit_rub": float(profit),
            "breakdown": {
                "cogs_rub": cogs_rub,
                "commission_rub": float(comm_rub),
                "commission_pct": comm,
                "acquiring_rub": float(acq_rub),
                "acquiring_pct": acquiring_pct,
                "last_mile_rub": b["last_mile_rub"],
                "storage_rub": b["storage_rub"],
                "return_cost_rub": b["return_cost_rub"],
                "return_rate_pct": return_rate_pct,
                "tax_rub": float(tax_rub),
                "usn_rate_pct": usn_rate_pct,
                "total_costs": float(total),
            },
        }

    # Multi-margin mode
    targets = margin_targets or ([target_margin_pct] if target_margin_pct is not None else [0])
    results = []
    for tm in targets:
        comm = _resolve_comm_for_margin(tm)
        r = _calc_breakeven_single(commission_pct=comm, target_margin_pct=tm, **common)
        results.append(r)

    if len(results) == 1:
        return results[0]
    return {"margin_results": results}
