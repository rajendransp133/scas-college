from __future__ import annotations

from schemas.base import CamelModel


class AssignmentCreate(CamelModel):
    course_id: str
    teacher_id: str
    term_id: str


class AssignmentResponse(CamelModel):
    id: str
    course_id: str
    teacher_id: str
    term_id: str
