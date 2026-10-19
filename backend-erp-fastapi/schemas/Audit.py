from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import Field

from enums.AttendanceStatus import AttendanceStatusEnum
from enums.AuditAction import AuditActionEnum
from schemas.base import CamelModel, IsoDate


class AuditResponse(CamelModel):
    id: str
    at: datetime
    user_id: str
    action: AuditActionEnum
    course_id: Optional[str] = None
    term_id: Optional[str] = None
    date: Optional[str] = None
    period: Optional[int] = None
    student_id: Optional[str] = None
    # Frontend field names are `from` / `to`.
    from_status: Optional[AttendanceStatusEnum] = Field(
        default=None, serialization_alias="from"
    )
    to_status: Optional[AttendanceStatusEnum] = Field(
        default=None, serialization_alias="to"
    )
    note: Optional[str] = None


class LockDatePayload(CamelModel):
    date: Optional[IsoDate] = None
