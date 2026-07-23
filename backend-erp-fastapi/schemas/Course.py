from __future__ import annotations

from typing import Optional

from pydantic import Field

from enums.CourseType import CourseTypeEnum
from schemas.base import CamelModel


class CourseBase(CamelModel):
    name: str = Field(..., min_length=1, max_length=150)
    code: str = Field(..., min_length=1, max_length=30)
    credits: int = Field(..., ge=0, le=20)
    type: Optional[CourseTypeEnum] = None


class CourseCreate(CourseBase):
    pass


class CourseResponse(CourseBase):
    id: str


class CourseFlatResponse(CourseBase):
    """Course with its parentage resolved — a global lookup for roles that show
    course names but lack `manage_academics` and don't know the owning program."""

    id: str
    semester_id: str
    semester_number: int
    program_id: str
