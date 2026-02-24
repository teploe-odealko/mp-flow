from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException

from proxy.src.routes.admin_helpers import (
    _date_bounds,
    _date_windows,
    _merge_dimensions,
    _parse_jsonb,
    _source_key,
)


def test_parse_jsonb_accepts_dict_and_json_string() -> None:
    assert _parse_jsonb({"a": 1}) == {"a": 1}
    assert _parse_jsonb('{"a": 1}') == {"a": 1}
    assert _parse_jsonb("[1, 2, 3]") == {}
    assert _parse_jsonb("not-json") == {}


def test_date_bounds_validates_order() -> None:
    start, end = _date_bounds(date(2026, 2, 1), date(2026, 2, 3))
    assert start.isoformat() == "2026-02-01T00:00:00+00:00"
    assert end.isoformat() == "2026-02-04T00:00:00+00:00"

    with pytest.raises(HTTPException):
        _date_bounds(date(2026, 2, 3), date(2026, 2, 1))


def test_date_windows_chunks_and_handles_empty_ranges() -> None:
    windows = _date_windows(date(2026, 2, 1), date(2026, 2, 10), window_days=4)
    assert windows == [
        (date(2026, 2, 1), date(2026, 2, 4)),
        (date(2026, 2, 5), date(2026, 2, 8)),
        (date(2026, 2, 9), date(2026, 2, 10)),
    ]

    assert _date_windows(date(2026, 2, 2), date(2026, 2, 1), window_days=4) == []

    with pytest.raises(ValueError):
        _date_windows(date(2026, 2, 1), date(2026, 2, 1), window_days=0)


def test_merge_dimensions_respects_overwrite_flag() -> None:
    attrs = {"dimensions": {"package_length_cm": 10.0, "package_weight_kg": 0.5}}

    no_overwrite = _merge_dimensions(
        attrs,
        {
            "package_length_cm": 20,
            "package_width_cm": 5,
            "package_height_cm": "7.1299",
            "package_weight_kg": 0,
        },
        overwrite=False,
    )
    assert no_overwrite["dimensions"]["package_length_cm"] == 10.0
    assert no_overwrite["dimensions"]["package_width_cm"] == 5.0
    assert no_overwrite["dimensions"]["package_height_cm"] == 7.13
    assert no_overwrite["dimensions"]["package_weight_kg"] == 0.5

    overwrite = _merge_dimensions(
        attrs,
        {
            "package_length_cm": 20,
            "package_weight_kg": 1.25,
        },
        overwrite=True,
    )
    assert overwrite["dimensions"]["package_length_cm"] == 20.0
    assert overwrite["dimensions"]["package_weight_kg"] == 1.25


def test_source_key_is_stable_and_prefixed() -> None:
    first = _source_key("1688", "ABC-123")
    second = _source_key("1688", "abc-123")
    assert first == second
    assert first.startswith("1688:")
    assert len(first.split(":", maxsplit=1)[1]) == 12
