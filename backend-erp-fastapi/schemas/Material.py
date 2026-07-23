from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from schemas.base import CamelModel


class MaterialCreate(CamelModel):
    """A material is a shared link — nothing is uploaded to this server."""

    course_id: str
    term_id: str
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    url: str = Field(min_length=1, max_length=2048)


class MaterialResponse(CamelModel):
    id: str
    course_id: str
    term_id: str
    title: str
    description: Optional[str] = None
    url: str
    uploaded_by: str
    uploaded_at: datetime
