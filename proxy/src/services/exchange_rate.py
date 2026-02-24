"""
Exchange rate service using Central Bank of Russia (CBR) API.

Fetches real-time USD/RUB exchange rate with caching.

API Source: https://www.cbr-xml-daily.ru/
Official CBR data, updated daily at ~11:30 MSK.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx

# CBR JSON API endpoint (unofficial mirror with JSON format)
CBR_API_URL = "https://www.cbr-xml-daily.ru/daily_json.js"

# Cache duration in seconds (1 hour)
CACHE_TTL_SECONDS = 3600

# Fallback rate if API is unavailable
FALLBACK_USD_RATE = 77.0


@dataclass
class ExchangeRateCache:
    """Cached exchange rate data."""

    usd_rate: float
    eur_rate: float
    timestamp: float  # Unix timestamp when fetched
    date: str  # CBR date string


# Global cache
_cache: ExchangeRateCache | None = None
_cache_lock = asyncio.Lock()


async def fetch_cbr_rates() -> dict[str, Any]:
    """
    Fetch current exchange rates from CBR API.

    Returns:
        Raw JSON response from CBR API

    Raises:
        httpx.HTTPError: If request fails
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(CBR_API_URL)
        response.raise_for_status()
        return response.json()


async def get_usd_rate(use_cache: bool = True) -> float:
    """
    Get current USD/RUB exchange rate.

    Args:
        use_cache: Whether to use cached value if available

    Returns:
        USD to RUB exchange rate
    """
    global _cache

    # Check cache
    if use_cache and _cache is not None:
        age = time.time() - _cache.timestamp
        if age < CACHE_TTL_SECONDS:
            return _cache.usd_rate

    # Fetch fresh data
    async with _cache_lock:
        # Double-check after acquiring lock
        if use_cache and _cache is not None:
            age = time.time() - _cache.timestamp
            if age < CACHE_TTL_SECONDS:
                return _cache.usd_rate

        try:
            data = await fetch_cbr_rates()
            usd_data = data.get("Valute", {}).get("USD", {})
            eur_data = data.get("Valute", {}).get("EUR", {})

            _cache = ExchangeRateCache(
                usd_rate=float(usd_data.get("Value", FALLBACK_USD_RATE)),
                eur_rate=float(eur_data.get("Value", FALLBACK_USD_RATE * 1.1)),
                timestamp=time.time(),
                date=data.get("Date", ""),
            )
            return _cache.usd_rate

        except Exception as e:
            # Log error and return fallback/cached value
            print(f"[exchange_rate] Error fetching CBR rates: {e}")
            if _cache is not None:
                return _cache.usd_rate
            return FALLBACK_USD_RATE


async def get_eur_rate(use_cache: bool = True) -> float:
    """
    Get current EUR/RUB exchange rate.

    Args:
        use_cache: Whether to use cached value if available

    Returns:
        EUR to RUB exchange rate
    """
    global _cache

    # Ensure cache is populated
    await get_usd_rate(use_cache=use_cache)

    if _cache is not None:
        return _cache.eur_rate

    return FALLBACK_USD_RATE * 1.1  # Rough EUR fallback


def get_cached_rate() -> float | None:
    """
    Get cached USD rate without fetching.

    Returns:
        Cached rate or None if not available
    """
    if _cache is not None:
        return _cache.usd_rate
    return None


def get_cache_info() -> dict[str, Any] | None:
    """
    Get cache metadata for debugging.

    Returns:
        Cache info dict or None
    """
    if _cache is None:
        return None

    age = time.time() - _cache.timestamp
    return {
        "usd_rate": _cache.usd_rate,
        "eur_rate": _cache.eur_rate,
        "date": _cache.date,
        "cache_age_seconds": int(age),
        "cache_ttl_seconds": CACHE_TTL_SECONDS,
        "is_stale": age >= CACHE_TTL_SECONDS,
    }


async def usd_to_kopecks(usd_amount: float) -> int:
    """
    Convert USD amount to kopecks using current rate.

    Args:
        usd_amount: Amount in USD

    Returns:
        Amount in kopecks (1/100 of ruble)
    """
    rate = await get_usd_rate()
    rubles = usd_amount * rate
    return int(rubles * 100)


async def kopecks_to_usd(kopecks: int) -> float:
    """
    Convert kopecks to USD using current rate.

    Args:
        kopecks: Amount in kopecks

    Returns:
        Amount in USD
    """
    rate = await get_usd_rate()
    rubles = kopecks / 100
    return rubles / rate


# Pricing documentation URL
PRICING_DOC_URL = "https://www.cbr-xml-daily.ru/"
