"""Enrichment reader helpers — cross-plugin data access via attributes.sources."""

from __future__ import annotations

from typing import Any


def get_enrichments_by_kind(attributes: dict[str, Any] | None, kind: str) -> list[dict[str, Any]]:
    """Return all enrichment sources matching a given kind."""
    if not isinstance(attributes, dict):
        return []
    sources = attributes.get("sources")
    if not isinstance(sources, dict):
        return []
    return [s for s in sources.values() if isinstance(s, dict) and s.get("kind") == kind]


def get_supplier_photos(attributes: dict[str, Any] | None) -> list[str]:
    """Collect images from all sources with kind='supplier'."""
    images: list[str] = []
    for source in get_enrichments_by_kind(attributes, "supplier"):
        data = source.get("data")
        if isinstance(data, dict):
            for img in data.get("images") or []:
                if img and img not in images:
                    images.append(img)
    return images


def get_enrichment_by_provider(
    attributes: dict[str, Any] | None, provider: str
) -> dict[str, Any] | None:
    """Return the latest enrichment from a specific provider."""
    if not isinstance(attributes, dict):
        return None
    sources = attributes.get("sources")
    if not isinstance(sources, dict):
        return None
    matches = [s for s in sources.values() if isinstance(s, dict) and s.get("provider") == provider]
    if not matches:
        return None
    return max(matches, key=lambda s: s.get("updated_at", ""))
