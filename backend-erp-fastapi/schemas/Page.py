from __future__ import annotations

from typing import Generic, Sequence, TypeVar

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Envelope for every paginated list endpoint.

    `total` is the count *after* filters and *before* the page slice, so the
    client can render "showing 1–25 of 4,787" and a page count without ever
    holding the full result set.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    items: list[T]
    total: int
    page: int
    page_size: int
    total_pages: int

    @classmethod
    def of(
        cls, items: Sequence[T], total: int, page: int, page_size: int
    ) -> "Page[T]":
        total_pages = max(1, -(-total // page_size))  # ceil
        return cls(
            items=list(items),
            total=total,
            page=page,
            page_size=page_size,
            total_pages=total_pages,
        )
