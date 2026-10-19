from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field, field_validator

from enums.AttendanceStatus import AttendanceStatusEnum
from schemas.base import CamelModel, IsoDate


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
    date: IsoDate
    period: int = Field(..., ge=1, le=12)
    term_id: str
    records: list[AttendanceRecordInput]

    @field_validator("records")
    @classmethod
    def _one_record_per_student(
        cls, records: list[AttendanceRecordInput]
    ) -> list[AttendanceRecordInput]:
        # Two entries for one student is ambiguous (which status wins?) and
        # used to reach the unique constraint as a 500.
        seen: set[str] = set()
        for r in records:
            if r.student_id in seen:
                raise ValueError(f"Student {r.student_id} appears more than once")
            seen.add(r.student_id)
        return records


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
