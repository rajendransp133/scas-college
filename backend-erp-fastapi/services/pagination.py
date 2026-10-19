"""Shared pagination + search helpers for list endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Sequence

from fastapi import Query
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 25


@dataclass(frozen=True)
class PageParams:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def page_params(
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(
        DEFAULT_PAGE_SIZE,
        ge=1,
        le=MAX_PAGE_SIZE,
        alias="pageSize",
        description=f"Rows per page (max {MAX_PAGE_SIZE})",
    ),
) -> PageParams:
    """FastAPI dependency — `?page=2&pageSize=50` on any list endpoint."""
    return PageParams(page=page, page_size=page_size)


async def count_of(db: AsyncSession, stmt: Select) -> int:
    """Total rows the (filtered, unpaged) statement would return.

    Wraps the statement as a subquery rather than re-deriving the filters, so
    the count can never drift from the page query. ORDER BY is stripped — it
    costs a sort and cannot change a count.
    """
    counted = stmt.order_by(None).options().with_only_columns(
        func.count(), maintain_column_froms=True
    )
    return (await db.execute(counted)).scalar_one()


async def paginate(
    db: AsyncSession, stmt: Select, params: PageParams
) -> tuple[Sequence[Any], int]:
    """Run `stmt` for one page and return (rows, total)."""
    total = await count_of(db, stmt)
    if total == 0:
        return [], 0
    rows = await db.execute(stmt.limit(params.page_size).offset(params.offset))
    return list(rows.scalars().all()), total


def apply_sort(
    stmt: Select,
    sort_by: Optional[str],
    sort_dir: Optional[str],
    allowed: dict[str, Any],
    default: Any,
):
    """Whitelisted ORDER BY — `allowed` maps an API field name to a column, so
    a client-supplied string can never reach SQL."""
    column = allowed.get(sort_by or "", default)
    descending = (sort_dir or "asc").lower() == "desc"
    return stmt.order_by(column.desc() if descending else column.asc())


def search_clause(term: str, *columns: Any):
    """Case-insensitive substring match across `columns` (trigram-indexed).

    `%` and `_` in the search text are escaped, so they match themselves — a
    search for "_" otherwise matched every row.
    """
    escaped = (
        term.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    )
    needle = f"%{escaped}%"
    return [func.lower(c).like(needle, escape="\\") for c in columns]


__all__ = [
    "DEFAULT_PAGE_SIZE",
    "MAX_PAGE_SIZE",
    "PageParams",
    "apply_sort",
    "count_of",
    "page_params",
    "paginate",
    "search_clause",
    "select",
]
