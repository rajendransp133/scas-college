from __future__ import annotations

from typing import Any, Mapping, Optional

from fastapi import HTTPException, status
from pydantic.alias_generators import to_camel
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from enums.AttendanceStatus import AttendanceStatusEnum
from enums.AuditAction import AuditActionEnum
from ids import new_id
from models import AttendanceRecord, AttendanceSession, AuditEntry, User
from services.util import now_utc


async def guard_attendance_cascade(
    db: AsyncSession,
    user: User,
    *,
    label: str,
    courses: Optional[Select] = None,
    student_id: Optional[str] = None,
) -> None:
    """Call before a delete whose FK cascade reaches `attendance_record`.

    Deleting a student, course, semester, program or department used to erase
    every attendance record under it — and the `original_status` trail with it —
    without a line in the audit log and regardless of the attendance lock: the
    strongest cover for tampering the system offered, and it needed no
    correction rights at all. So, when any attendance would go:

    * a role without `override_lock` is refused if any affected date is locked;
    * one audit entry records what was removed and by whom (the rows themselves
      are gone, so the log is the only evidence left).

    `courses` is a SELECT of course ids (for curriculum deletes); `student_id`
    names a student (for a student delete). Exactly one is given.
    """
    from services.attendance import is_locked_for  # attendance imports this module

    records = select(
        func.count(AttendanceRecord.id).label("records"),
        func.count(func.distinct(AttendanceSession.id)).label("sessions"),
        func.min(AttendanceSession.date).label("earliest"),
    ).select_from(AttendanceRecord).join(
        AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id
    )
    if student_id is not None:
        records = records.where(AttendanceRecord.student_id == student_id)
    else:
        records = records.where(AttendanceSession.course_id.in_(courses))
    found = (await db.execute(records)).one()
    if not found.records:
        return

    if await is_locked_for(db, user, found.earliest):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"{label} has attendance on locked dates and cannot be deleted. "
                "Deactivate it instead, or contact the college office."
            ),
        )
    db.add(
        make_audit(
            user.id,
            AuditActionEnum.REMOVE_RECORD if student_id else AuditActionEnum.DELETE_SESSION,
            student_id=student_id,
            note=(
                f"{label} deleted: {found.records} attendance records across "
                f"{found.sessions} sessions removed (earliest {found.earliest})"
            ),
        )
    )


def changed_fields(row: object, fields: Mapping[str, Any]) -> list[str]:
    """camelCase names of the fields an update would actually change on `row`.

    For administrative audit notes: *which* fields changed, never their values
    — a student update can touch an address or a guardian's phone, and the log
    is readable by every `view_audit` role and kept forever. Call it before the
    update is applied. `password` is never a column, so callers report a reset
    separately.
    """
    return [
        to_camel(key)
        for key, value in fields.items()
        if key != "password" and getattr(row, key, None) != value
    ]


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
