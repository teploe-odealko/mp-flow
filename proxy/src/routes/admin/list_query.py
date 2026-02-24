"""Reusable list-endpoint utilities: query params, WHERE builder, response envelope.

Usage in a route handler::

    from proxy.src.routes.admin.list_query import ListQuery, WhereBuilder, list_query_dep, list_response

    SORT_FIELDS = {"title", "created_at"}

    @router.get("/items")
    async def list_items(
        request: Request,
        lq: ListQuery = Depends(list_query_dep(allowed_sort=SORT_FIELDS, default_sort="title:asc")),
        user: dict = Depends(get_current_user),
    ):
        wb = WhereBuilder()
        wb.exact("user_id", user_id)
        wb.ilike_multi(["title", "sku"], lq.q)
        where_sql, params = wb.build()
        ...
        return list_response(items, total, lq)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException, Query

# ---------------------------------------------------------------------------
# ListQuery — parsed list endpoint query params
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ListQuery:
    q: str | None = None
    sort_field: str = "created_at"
    sort_dir: str = "desc"
    limit: int = 50
    offset: int = 0


def list_query_dep(
    *,
    allowed_sort: set[str],
    default_sort: str = "created_at:desc",
    default_limit: int = 50,
    max_limit: int = 500,
):
    """Factory that returns a FastAPI ``Depends()`` callable.

    Example::

        lq: ListQuery = Depends(list_query_dep(allowed_sort={"title","sku"}, default_sort="title:asc"))
    """

    def _parse(
        q: str | None = Query(default=None, max_length=200, description="Search text (ILIKE)"),
        sort: str | None = Query(
            default=None,
            max_length=60,
            description="Sort field:direction, e.g. title:asc",
        ),
        limit: int = Query(default=default_limit, ge=1, le=max_limit),
        offset: int = Query(default=0, ge=0),
    ) -> ListQuery:
        raw = (sort or default_sort).strip().lower()
        if ":" in raw:
            sf, sd = raw.split(":", maxsplit=1)
        else:
            sf, sd = raw, "desc"

        if sf not in allowed_sort:
            allowed = ", ".join(sorted(allowed_sort))
            raise HTTPException(
                status_code=400,
                detail=f"Invalid sort field '{sf}'. Allowed: {allowed}",
            )
        if sd not in {"asc", "desc"}:
            raise HTTPException(status_code=400, detail="Sort direction must be 'asc' or 'desc'")

        return ListQuery(
            q=q.strip() if q else None,
            sort_field=sf,
            sort_dir=sd,
            limit=limit,
            offset=offset,
        )

    return _parse


# ---------------------------------------------------------------------------
# WhereBuilder — safe parameterised WHERE clause accumulator
# ---------------------------------------------------------------------------


class WhereBuilder:
    """Accumulates SQL WHERE conditions with correct ``$N`` param indexing.

    All column/expression strings come from developer-defined constants (never
    from user input), so f-string interpolation of column names is safe.
    User-supplied values always go into ``$N`` positional params.
    """

    def __init__(self) -> None:
        self._conditions: list[str] = []
        self._params: list[Any] = []

    @property
    def next_idx(self) -> int:
        return len(self._params) + 1

    # --- filter methods ---

    def exact(self, column: str, value: Any) -> WhereBuilder:
        """Equality — always applied (use for tenant isolation)."""
        self._conditions.append(f"{column} = ${self.next_idx}")
        self._params.append(value)
        return self

    def exact_optional(self, column: str, value: Any) -> WhereBuilder:
        """Equality — skipped when *value* is ``None``."""
        if value is not None:
            self.exact(column, value)
        return self

    def not_equal(self, column: str, value: Any) -> WhereBuilder:
        """Inequality — always applied."""
        self._conditions.append(f"{column} != ${self.next_idx}")
        self._params.append(value)
        return self

    def not_equal_optional(self, column: str, value: Any) -> WhereBuilder:
        """Inequality — skipped when *value* is ``None``."""
        if value is not None:
            self.not_equal(column, value)
        return self

    def ilike(self, column: str, value: str | None) -> WhereBuilder:
        """Case-insensitive LIKE on one column. No-op when *value* is falsy."""
        if value:
            self._conditions.append(f"{column} ILIKE '%' || ${self.next_idx} || '%'")
            self._params.append(value.strip())
        return self

    def ilike_multi(self, columns: list[str], value: str | None) -> WhereBuilder:
        """Case-insensitive LIKE across multiple columns (OR). No-op when *value* is falsy."""
        if not value or not columns:
            return self
        idx = self.next_idx
        or_parts = [f"{col} ILIKE '%' || ${idx} || '%'" for col in columns]
        self._conditions.append(f"({' OR '.join(or_parts)})")
        self._params.append(value.strip())
        return self

    def boolean(self, column: str, value: bool | None) -> WhereBuilder:
        """Boolean filter — skipped when *value* is ``None``."""
        if value is not None:
            self._conditions.append(f"{column} = ${self.next_idx}")
            self._params.append(value)
        return self

    def date_range(
        self, column: str, from_dt: datetime | None, to_dt: datetime | None
    ) -> WhereBuilder:
        """Date range (inclusive start, exclusive end). Either bound can be ``None``."""
        if from_dt is not None:
            self._conditions.append(f"{column} >= ${self.next_idx}")
            self._params.append(from_dt)
        if to_dt is not None:
            self._conditions.append(f"{column} < ${self.next_idx}")
            self._params.append(to_dt)
        return self

    def in_list(self, column: str, values: list[Any] | None, pg_type: str = "text") -> WhereBuilder:
        """``ANY($N::type[])`` filter. No-op when *values* is empty/``None``."""
        if values:
            self._conditions.append(f"{column} = ANY(${self.next_idx}::{pg_type}[])")
            self._params.append(values)
        return self

    def raw(self, condition: str, *values: Any) -> WhereBuilder:
        """Escape hatch. Caller must use ``${wb.next_idx}`` to compute param slots *before* calling."""
        self._conditions.append(condition)
        self._params.extend(values)
        return self

    # --- output ---

    def build(self) -> tuple[str, list[Any]]:
        """Return ``("WHERE cond1 AND cond2 ...", [param1, param2, ...])``.

        Returns ``("WHERE TRUE", [])`` when no conditions were added.
        """
        if not self._conditions:
            return "WHERE TRUE", []
        return "WHERE " + " AND ".join(self._conditions), list(self._params)


# ---------------------------------------------------------------------------
# Response envelope
# ---------------------------------------------------------------------------


def list_response(
    items: list[dict[str, Any]],
    total: int,
    lq: ListQuery,
    **extra: Any,
) -> dict[str, Any]:
    """Standard list-endpoint response envelope."""
    resp: dict[str, Any] = {
        "items": items,
        "total": total,
        "limit": lq.limit,
        "offset": lq.offset,
        "sort": f"{lq.sort_field}:{lq.sort_dir}",
    }
    resp.update(extra)
    return resp
