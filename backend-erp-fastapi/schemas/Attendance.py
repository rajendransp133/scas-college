from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from enums.AttendanceStatus import AttendanceStatusEnum
from schemas.base import CamelModel


class AttendanceRecordInput(CamelModel):
    student_id: str
    status: AttendanceStatusEnum


class AttendanceRecordResponse(CamelModel):
    student_id: str
    status: AttendanceStatusEnum
    original_status: Optional[AttendanceStatusEnum] = None
    edited_by: Optional[str] = None
    edited_at: Optional[datetime] = None


class SaveAttendancePayload(CamelModel):
    course_id: str
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    period: int = Field(..., ge=1, le=12)
    term_id: str
    records: list[AttendanceRecordInput]


class SetStatusPayload(CamelModel):
    status: AttendanceStatusEnum


class AttendanceSessionResponse(CamelModel):
    id: str
    course_id: str
    term_id: str
    date: str
    period: int
    marked_by: Optional[str] = None
    marked_at: Optional[datetime] = None
    records: list[AttendanceRecordResponse] = []
