from __future__ import annotations

from pydantic import Field

from schemas.base import CamelModel
from schemas.Course import CourseResponse


class SemesterCreate(CamelModel):
    program_id: str
    number: int = Field(..., ge=1, le=12)


class SemesterResponse(CamelModel):
    id: str
    program_id: str
    number: int
    courses: list[CourseResponse] = []
