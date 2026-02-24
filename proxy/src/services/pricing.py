"""
Pricing configuration for all billable services.

All prices stored in USD, converted to kopecks using real-time CBR exchange rate.
Designed for easy extension - just add new provider config.

PRICING SOURCES (last updated: 2026-02-08):
- Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
- Gemini: https://ai.google.dev/gemini-api/docs/pricing
- Perplexity Sonar: https://docs.perplexity.ai/getting-started/pricing
- Brave Search: https://brave.com/search/api/
- Firecrawl: https://www.firecrawl.dev/pricing
- Yandex Search API: https://yandex.cloud/en/docs/search-api/pricing
- Yandex Vision: https://cloud.yandex.com/en/docs/vision/pricing
- TMAPI (1688): https://tmapi.top/
- Timeweb S3: https://timeweb.cloud/services/s3-storage

Exchange rate: Real-time from CBR API (https://www.cbr-xml-daily.ru/)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from proxy.src.services.exchange_rate import get_cached_rate

# Fallback exchange rate if CBR API unavailable
FALLBACK_USD_RATE = 77.0


def _get_usd_rate() -> float:
    """Get current USD rate (cached) or fallback."""
    rate = get_cached_rate()
    return rate if rate is not None else FALLBACK_USD_RATE


class BillingUnit(Enum):
    """Unit of measurement for billing."""

    TOKENS = "tokens"  # LLM tokens (input + output)
    REQUESTS = "requests"  # API requests count
    IMAGES = "images"  # Image processing
    BYTES = "bytes"  # Data transfer (S3)
    PAGES = "pages"  # Web pages scraped


@dataclass
class ProviderPricing:
    """Pricing configuration for a provider."""

    name: str
    unit: BillingUnit
    # Price per unit in USD (converted to kopecks at runtime)
    # For tokens: price per 1M tokens
    # For requests/images/pages: price per item
    # For bytes: price per MB
    price_usd: float = 0.0
    # Optional: separate input/output pricing for LLMs (per 1M tokens)
    input_price_usd_per_1m: float | None = None
    output_price_usd_per_1m: float | None = None
    # Legacy/default cache-write rate (used when TTL-specific rates are absent)
    cache_creation_input_price_usd_per_1m: float | None = None
    # TTL-specific cache-write rates (Anthropic supports 5m and 1h)
    cache_creation_input_price_usd_per_1m_5m: float | None = None
    cache_creation_input_price_usd_per_1m_1h: float | None = None
    cache_read_input_price_usd_per_1m: float | None = None
    # Price in RUB (for Russian services like Yandex)
    price_rub: float | None = None
    input_price_rub_per_1k: float | None = None
    output_price_rub_per_1k: float | None = None
    # Description for billing reports
    description: str = ""
    # Documentation URL for pricing reference
    pricing_url: str = ""


# ============================================================
# PRICING CONFIGURATION
# ============================================================
# USD prices converted to kopecks at runtime using CBR rate.
# RUB prices used directly (for Yandex services).

PROVIDER_PRICING: dict[str, ProviderPricing] = {
    # --- LLM Providers ---
    # Claude Haiku 4.5: $1/1M input, $5/1M output
    # Prompt caching (5m): writes $1.25/1M, reads $0.10/1M
    "anthropic": ProviderPricing(
        name="Anthropic Claude",
        unit=BillingUnit.TOKENS,
        input_price_usd_per_1m=1.0,  # $1 per 1M input tokens
        output_price_usd_per_1m=5.0,  # $5 per 1M output tokens
        cache_creation_input_price_usd_per_1m=1.25,  # Legacy/fallback cache-write rate
        cache_creation_input_price_usd_per_1m_5m=1.25,  # $1.25 per 1M cache writes (5m)
        cache_creation_input_price_usd_per_1m_1h=2.0,  # $2.00 per 1M cache writes (1h)
        cache_read_input_price_usd_per_1m=0.10,  # $0.10 per 1M cache reads
        description="Claude Haiku 4.5 API",
        pricing_url="https://platform.claude.com/docs/en/about-claude/pricing",
    ),
    # Gemini 3 Pro Preview: $2/1M input, $12/1M output (≤200K context)
    # Note: billing_multiplier (x3) is applied separately in image.py
    "gemini": ProviderPricing(
        name="Google Gemini",
        unit=BillingUnit.TOKENS,
        input_price_usd_per_1m=2.0,  # $2 per 1M input tokens
        output_price_usd_per_1m=12.0,  # $12 per 1M output tokens
        description="Gemini 3 Pro Preview (vision + image generation)",
        pricing_url="https://ai.google.dev/gemini-api/docs/pricing",
    ),
    # --- Embeddings ---
    # OpenAI text-embedding-3-small: $0.02/1M tokens
    "openai_embeddings": ProviderPricing(
        name="OpenAI Embeddings",
        unit=BillingUnit.TOKENS,
        price_usd=0.02 / 1_000_000,  # $0.02 per 1M tokens = $0.00000002 per token
        description="OpenAI text-embedding-3-small (semantic search)",
        pricing_url="https://openai.com/api/pricing/",
    ),
    # Gemini embeddings: No charge (using shared API key)
    "gemini_embeddings": ProviderPricing(
        name="Gemini Embeddings",
        unit=BillingUnit.TOKENS,
        price_usd=0.00,  # No charge (shared API key)
        description="Google Gemini Embeddings (semantic search)",
        pricing_url="https://ai.google.dev/gemini-api/docs/pricing",
    ),
    # --- Search ---
    # Perplexity Sonar Pro: $6/1000 requests = $0.006/request
    "perplexity": ProviderPricing(
        name="Perplexity Sonar",
        unit=BillingUnit.REQUESTS,
        price_usd=0.006,  # $6/1000 requests (sonar-pro)
        description="Perplexity Sonar Pro (AI web search with citations)",
        pricing_url="https://docs.perplexity.ai/getting-started/pricing",
    ),
    # Brave Search: $9/1000 requests = $0.009/request
    "brave_search": ProviderPricing(
        name="Brave Search",
        unit=BillingUnit.REQUESTS,
        price_usd=0.009,  # $9/1000 requests = $0.009/request
        description="Brave Search API (web search, shared key)",
        pricing_url="https://brave.com/search/api/",
    ),
    # Firecrawl: Extra credits $9/1000 = $0.009/page
    "firecrawl": ProviderPricing(
        name="Firecrawl",
        unit=BillingUnit.PAGES,
        price_usd=0.009,  # $0.009 per page
        description="Web scraping (1688, AliExpress, etc.)",
        pricing_url="https://www.firecrawl.dev/pricing",
    ),
    # Yandex Search API (image search): $7.50/1000 requests = $0.0075/request
    "yandex_search": ProviderPricing(
        name="Yandex Search",
        unit=BillingUnit.REQUESTS,
        price_usd=0.0075,  # $7.50/1000 requests (image search tier)
        description="Yandex Search API (reverse image search)",
        pricing_url="https://yandex.cloud/en/docs/search-api/pricing",
    ),
    # Yandex Vision OCR: ~120 RUB per 1000 units = 0.12 RUB/image
    "yandex_vision": ProviderPricing(
        name="Yandex Vision",
        unit=BillingUnit.IMAGES,
        price_rub=0.15,  # ~0.12-0.15 RUB/image (with margin)
        description="Yandex Vision OCR (image analysis)",
        pricing_url="https://cloud.yandex.com/en/docs/vision/pricing",
    ),
    # Yandex Wordstat: Free (Preview stage per Yandex docs)
    "yandex_wordstat": ProviderPricing(
        name="Yandex Wordstat",
        unit=BillingUnit.REQUESTS,
        price_rub=0.0,  # Free (Preview stage)
        description="Yandex Wordstat API (keyword research, free preview)",
        pricing_url="https://yandex.cloud/en/docs/search-api/pricing",
    ),
    # --- E-commerce APIs ---
    # TMAPI 1688: ~$0.01/request (estimated based on plan)
    "tmapi_1688": ProviderPricing(
        name="1688 API (TMAPI)",
        unit=BillingUnit.REQUESTS,
        price_usd=0.01,  # ~$0.01/request (estimated)
        description="1688.com product data (photos, prices, SKU)",
        pricing_url="https://tmapi.top/",
    ),
    # --- Storage ---
    # Timeweb S3: 2 RUB/GB = 0.002 RUB/MB
    "s3_upload": ProviderPricing(
        name="S3 Upload",
        unit=BillingUnit.BYTES,
        price_rub=0.005,  # ~0.005 RUB/MB (storage + transfer margin)
        description="Timeweb S3 file upload (photo hosting)",
        pricing_url="https://timeweb.cloud/services/s3-storage",
    ),
    # --- Marketplaces ---
    "ozon": ProviderPricing(
        name="Ozon Seller API",
        unit=BillingUnit.REQUESTS,
        price_usd=0,  # Free (seller's own API key)
        description="Ozon Seller API calls",
        pricing_url="https://docs.ozon.ru/api/seller/",
    ),
}


def _usd_to_kopecks(usd: float) -> float:
    """Convert USD to kopecks using current exchange rate."""
    rate = _get_usd_rate()
    return usd * rate * 100  # USD -> RUB -> kopecks


def _rub_to_kopecks(rub: float) -> float:
    """Convert RUB to kopecks."""
    return rub * 100


def calculate_cost(
    provider: str,
    quantity: int,
    metadata: dict[str, Any] | None = None,
) -> int:
    """
    Calculate cost in kopecks for a usage event.

    Uses real-time USD/RUB exchange rate for USD-priced services.

    Args:
        provider: Provider name (key in PROVIDER_PRICING)
        quantity: Number of units used
        metadata: Optional metadata (e.g., input_tokens, output_tokens for LLMs)

    Returns:
        Cost in kopecks (rounded down)
    """
    pricing = PROVIDER_PRICING.get(provider)
    if not pricing:
        return 0

    def _to_int(value: Any) -> int:
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, (int, float)):
            return int(value)
        try:
            return int(value)
        except Exception:
            return 0

    # LLM providers with input/output token pricing
    if pricing.input_price_usd_per_1m is not None and metadata:
        input_tokens = _to_int(metadata.get("input_tokens", 0))
        output_tokens = _to_int(metadata.get("output_tokens", 0))

        cache_creation_input_tokens = _to_int(metadata.get("cache_creation_input_tokens", 0))
        cache_read_input_tokens = _to_int(metadata.get("cache_read_input_tokens", 0))

        cache_creation_5m_tokens = _to_int(
            metadata.get("cache_creation_ephemeral_5m_input_tokens", 0)
        )
        cache_creation_1h_tokens = _to_int(
            metadata.get("cache_creation_ephemeral_1h_input_tokens", 0)
        )
        cache_read_5m_tokens = _to_int(metadata.get("cache_read_ephemeral_5m_input_tokens", 0))
        cache_read_1h_tokens = _to_int(metadata.get("cache_read_ephemeral_1h_input_tokens", 0))

        # Backward compatibility with nested usage payloads
        cache_creation_obj = metadata.get("cache_creation")
        if isinstance(cache_creation_obj, dict):
            if cache_creation_input_tokens == 0:
                cache_creation_input_tokens = _to_int(cache_creation_obj.get("input_tokens", 0))
            if cache_creation_5m_tokens == 0:
                cache_creation_5m_tokens = _to_int(
                    cache_creation_obj.get("ephemeral_5m_input_tokens", 0)
                )
            if cache_creation_1h_tokens == 0:
                cache_creation_1h_tokens = _to_int(
                    cache_creation_obj.get("ephemeral_1h_input_tokens", 0)
                )

        cache_read_obj = metadata.get("cache_read")
        if isinstance(cache_read_obj, dict):
            if cache_read_input_tokens == 0:
                cache_read_input_tokens = _to_int(cache_read_obj.get("input_tokens", 0))
            if cache_read_5m_tokens == 0:
                cache_read_5m_tokens = _to_int(cache_read_obj.get("ephemeral_5m_input_tokens", 0))
            if cache_read_1h_tokens == 0:
                cache_read_1h_tokens = _to_int(cache_read_obj.get("ephemeral_1h_input_tokens", 0))

        if cache_creation_input_tokens == 0:
            cache_creation_input_tokens = cache_creation_5m_tokens + cache_creation_1h_tokens
        if cache_read_input_tokens == 0:
            cache_read_input_tokens = cache_read_5m_tokens + cache_read_1h_tokens

        cache_creation_rate = (
            pricing.cache_creation_input_price_usd_per_1m or pricing.input_price_usd_per_1m
        )
        cache_creation_rate_5m = (
            pricing.cache_creation_input_price_usd_per_1m_5m or cache_creation_rate
        )
        cache_creation_rate_1h = (
            pricing.cache_creation_input_price_usd_per_1m_1h or cache_creation_rate
        )
        cache_read_rate = (
            pricing.cache_read_input_price_usd_per_1m or pricing.input_price_usd_per_1m
        )

        # Convert USD per 1M tokens to kopecks
        input_cost = (input_tokens / 1_000_000) * _usd_to_kopecks(pricing.input_price_usd_per_1m)
        cache_creation_known_tokens = cache_creation_5m_tokens + cache_creation_1h_tokens
        cache_creation_fallback_tokens = max(
            cache_creation_input_tokens - cache_creation_known_tokens, 0
        )
        cache_creation_cost = (
            (cache_creation_5m_tokens / 1_000_000) * _usd_to_kopecks(cache_creation_rate_5m)
            + (cache_creation_1h_tokens / 1_000_000) * _usd_to_kopecks(cache_creation_rate_1h)
            + (cache_creation_fallback_tokens / 1_000_000) * _usd_to_kopecks(cache_creation_rate)
        )

        cache_read_known_tokens = cache_read_5m_tokens + cache_read_1h_tokens
        cache_read_fallback_tokens = max(cache_read_input_tokens - cache_read_known_tokens, 0)
        cache_read_tokens_to_bill = (
            cache_read_fallback_tokens + cache_read_5m_tokens + cache_read_1h_tokens
        )
        cache_read_cost = (cache_read_tokens_to_bill / 1_000_000) * _usd_to_kopecks(cache_read_rate)
        output_cost = (output_tokens / 1_000_000) * _usd_to_kopecks(
            pricing.output_price_usd_per_1m or 0
        )
        return int(input_cost + cache_creation_cost + cache_read_cost + output_cost)

    # RUB-based LLM pricing (if any)
    if pricing.input_price_rub_per_1k is not None and metadata:
        input_tokens = metadata.get("input_tokens", 0)
        output_tokens = metadata.get("output_tokens", 0)
        input_cost = (input_tokens / 1000) * _rub_to_kopecks(pricing.input_price_rub_per_1k)
        output_cost = (output_tokens / 1000) * _rub_to_kopecks(pricing.output_price_rub_per_1k or 0)
        return int(input_cost + output_cost)

    # Standard per-unit pricing
    # For bytes, quantity is in bytes, price is per MB
    if pricing.unit == BillingUnit.BYTES:
        mb = quantity / (1024 * 1024)
        if pricing.price_rub is not None:
            return int(mb * _rub_to_kopecks(pricing.price_rub))
        return int(mb * _usd_to_kopecks(pricing.price_usd))

    # RUB-priced services (Yandex, etc.)
    if pricing.price_rub is not None:
        return int(quantity * _rub_to_kopecks(pricing.price_rub))

    # USD-priced services
    return int(quantity * _usd_to_kopecks(pricing.price_usd))


def get_provider_info(provider: str) -> ProviderPricing | None:
    """Get pricing info for a provider."""
    return PROVIDER_PRICING.get(provider)


def list_providers() -> list[str]:
    """List all configured providers."""
    return list(PROVIDER_PRICING.keys())


def get_pricing_urls() -> dict[str, str]:
    """Get all pricing documentation URLs."""
    return {
        key: pricing.pricing_url for key, pricing in PROVIDER_PRICING.items() if pricing.pricing_url
    }


def get_current_exchange_rate() -> float:
    """Get current USD/RUB exchange rate used for pricing."""
    return _get_usd_rate()


def format_price_display(provider: str) -> str:
    """Format pricing info for user display (in kopecks at current rate)."""
    pricing = PROVIDER_PRICING.get(provider)
    if not pricing:
        return f"Unknown provider: {provider}"

    rate = _get_usd_rate()

    # LLM with USD pricing
    if pricing.input_price_usd_per_1m is not None:
        input_kop = pricing.input_price_usd_per_1m * rate * 100 / 1000  # per 1K tokens
        output_kop = (pricing.output_price_usd_per_1m or 0) * rate * 100 / 1000
        return (
            f"{pricing.name}: {input_kop:.2f} коп/1K input, "
            f"{output_kop:.2f} коп/1K output (курс {rate:.2f}₽/$)"
        )

    # RUB-priced services
    if pricing.price_rub is not None:
        kop = pricing.price_rub * 100
        if pricing.unit == BillingUnit.BYTES:
            return f"{pricing.name}: {kop:.2f} коп/МБ"
        elif pricing.unit == BillingUnit.PAGES:
            return f"{pricing.name}: {kop:.0f} коп/страница"
        else:
            return f"{pricing.name}: {kop:.2f} коп/{pricing.unit.value}"

    # USD-priced services
    kop = pricing.price_usd * rate * 100
    if pricing.unit == BillingUnit.BYTES:
        return f"{pricing.name}: {kop:.2f} коп/МБ (курс {rate:.2f}₽/$)"
    elif pricing.unit == BillingUnit.PAGES:
        return f"{pricing.name}: {kop:.0f} коп/страница (курс {rate:.2f}₽/$)"
    else:
        return f"{pricing.name}: {kop:.2f} коп/{pricing.unit.value} (курс {rate:.2f}₽/$)"
