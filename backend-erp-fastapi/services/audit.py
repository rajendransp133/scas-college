from __future__ import annotations

from typing import Optional

from enums.AttendanceStatus import AttendanceStatusEnum
from enums.AuditAction import AuditActionEnum
from ids import new_id
from models import AuditEntry
from services.util import now_utc


def make_audit(
    user_id: Optional[str],
    action: AuditActionEnum,
    *,
    course_id: Optional[str] = None,
    term_id: Optional[str] = None,
    date: Optional[str] = None,
    period: Optional[int] = None,
    student_id: Optional[str] = None,
    from_status: Optional[AttendanceStatusEnum] = None,
    to_status: Optional[AttendanceStatusEnum] = None,
    note: Optional[str] = None,
) -> AuditEntry:
    """Mirror the store's `auditedBy`: stamp id/at/userId then the caller fields."""
    return AuditEntry(
        id=new_id("aud"),
        at=now_utc(),
        user_id=user_id or "",
        action=action,
        course_id=course_id,
        term_id=term_id,
        date=date,
        period=period,
        student_id=student_id,
        from_status=from_status,
        to_status=to_status,
        note=note,
    )
