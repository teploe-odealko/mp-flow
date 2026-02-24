from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException


@dataclass(frozen=True)
class ParsedSort:
    field: str
    direction: str


def parse_sort(sort: str | None, *, allowed_fields: set[str], default: str) -> ParsedSort:
    raw = (sort or default).strip().lower()
    if ":" in raw:
        field, direction = raw.split(":", maxsplit=1)
    else:
        field, direction = raw, "desc"

    if field not in allowed_fields:
        allowed = ", ".join(sorted(allowed_fields))
        raise HTTPException(
            status_code=400, detail=f"Invalid sort field '{field}'. Allowed: {allowed}"
        )
    if direction not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail="Sort direction must be 'asc' or 'desc'")
    return ParsedSort(field=field, direction=direction)


def encode_cursor(sort_value: str, object_id: str) -> str:
    payload = json.dumps({"v": sort_value, "id": object_id}, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(payload.encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[str, str] | None:
    if not cursor:
        return None
    padded = cursor + "=" * (-len(cursor) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        payload = json.loads(decoded)
        value = str(payload["v"])
        object_id = str(payload["id"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid cursor") from exc
    if not value or not object_id:
        raise HTTPException(status_code=400, detail="Invalid cursor payload")
    return value, object_id


def parse_datetime_cursor(cursor_value: str) -> datetime:
    try:
        return datetime.fromisoformat(cursor_value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid datetime cursor value") from exc
