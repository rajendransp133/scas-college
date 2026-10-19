from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from deps import ensure_can_mark
from enums.AuditAction import AuditActionEnum
from ids import new_id
from models import (
    AttendanceRecord,
    AttendanceSession,
    Course,
    Semester,
    Student,
    User,
)
from permissions import role_capabilities
from schemas.Attendance import SaveAttendancePayload
from services.audit import make_audit
from services.pagination import PageParams, count_of
from services.util import (
    commit_or_raise,
    not_found,
    now_utc,
    today_local,
    unprocessable,
)


async def is_locked_for(db: AsyncSession, user: User, date_str: str) -> bool:
    # Reads the cached settings — invalidated the moment the lock date changes,
    # so this can't authorise a write against a stale lock.
    from services.integrity import get_settings

    lock_date = (await get_settings(db))["lockDate"]
    if lock_date is None or date_str > lock_date:
        return False
    return not role_capabilities(user.role).override_lock


def _forbidden_locked() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Attendance for this date is locked",
    )


async def get_roster(db: AsyncSession, course_id: str) -> list[Student]:
    course = await db.get(Course, course_id)
    if course is None:
        raise not_found("Course not found")
    sem = await db.get(Semester, course.semester_id)
    if sem is None:
        raise not_found("Semester not found")
    rows = await db.execute(
        select(Student)
        .where(
            Student.program_id == sem.program_id,
            Student.current_semester == sem.number,
            Student.is_active.is_(True),
            Student.graduated.is_(False),
        )
        .order_by(Student.roll_number)
    )
    return list(rows.scalars().all())


def _sessions_filtered(
    course_id: Optional[str] = None,
    term_id: Optional[str] = None,
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    month: Optional[str] = None,
):
    stmt = select(AttendanceSession)
    if course_id:
        stmt = stmt.where(AttendanceSession.course_id == course_id)
    if term_id:
        stmt = stmt.where(AttendanceSession.term_id == term_id)
    if date:
        stmt = stmt.where(AttendanceSession.date == date)
    # Dates are ISO yyyy-mm-dd strings, so lexicographic compare == date compare
    # and the (course_id, term_id, date) index serves the range directly. A
    # month is written as a range, not `LIKE 'YYYY-MM%'`: a bound LIKE pattern
    # under a non-C collation can't use a btree at all.
    if month:
        stmt = stmt.where(
            AttendanceSession.date >= f"{month}-01",
            AttendanceSession.date <= f"{month}-31",
        )
    if date_from:
        stmt = stmt.where(AttendanceSession.date >= date_from)
    if date_to:
        stmt = stmt.where(AttendanceSession.date <= date_to)
    return stmt


async def get_class_roster(
    db: AsyncSession,
    course_id: str,
    term_id: Optional[str] = None,
    month: Optional[str] = None,
) -> list[Student]:
    """The register's row set: current class members **∪** anyone with saved
    marks in the scoped sessions.

    Students who left or graduated keep their rows for as long as they have
    attendance on record — history must never silently disappear from the
    register. Computed here rather than by shipping every student to the client
    and intersecting there.
    """
    course = await db.get(Course, course_id)
    if course is None:
        raise not_found("Course not found")
    sem = await db.get(Semester, course.semester_id)
    if sem is None:
        raise not_found("Semester not found")

    scoped_sessions = _sessions_filtered(
        course_id=course_id, term_id=term_id, month=month
    ).with_only_columns(AttendanceSession.id)
    marked_ids = select(AttendanceRecord.student_id).where(
        AttendanceRecord.session_id.in_(scoped_sessions)
    )

    rows = await db.execute(
        select(Student)
        .where(
            or_(
                and_(
                    Student.program_id == sem.program_id,
                    Student.current_semester == sem.number,
                    Student.is_active.is_(True),
                    Student.graduated.is_(False),
                ),
                Student.id.in_(marked_ids),
            )
        )
        .order_by(Student.roll_number)
    )
    return list(rows.scalars().all())


async def list_sessions(
    db: AsyncSession,
    params: PageParams,
    course_id: Optional[str] = None,
    term_id: Optional[str] = None,
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    month: Optional[str] = None,
    allowed_course_ids: Optional[set[str]] = None,
) -> tuple[list[AttendanceSession], int]:
    """`allowed_course_ids` is the caller's read scope (see `services/scope.py`);
    `None` means unrestricted. It is applied here rather than by the router
    because an unscoped call with no `course_id` returns every session in the
    college."""
    stmt = _sessions_filtered(
        course_id, term_id, date, date_from, date_to, month
    ).order_by(AttendanceSession.date, AttendanceSession.period)
    if allowed_course_ids is not None:
        if not allowed_course_ids:
            return [], 0
        stmt = stmt.where(AttendanceSession.course_id.in_(allowed_course_ids))
    total = await count_of(db, stmt)
    if total == 0:
        return [], 0
    # `records` is lazy="selectin" — one extra query for the page's sessions,
    # not for all 202k of them.
    rows = await db.execute(stmt.limit(params.page_size).offset(params.offset))
    return list(rows.scalars().all()), total


async def get_register(
    db: AsyncSession,
    course_id: str,
    term_id: Optional[str] = None,
    month: Optional[str] = None,
) -> list[AttendanceSession]:
    """Every session for one course (optionally one month) with its records —
    the students × sessions matrix. Bounded by the class, so it needs no page:
    one course/term is at most a few hundred sessions."""
    stmt = _sessions_filtered(
        course_id=course_id, term_id=term_id, month=month
    ).order_by(AttendanceSession.date, AttendanceSession.period)
    rows = await db.execute(stmt)
    return list(rows.scalars().all())


async def list_session_months(
    db: AsyncSession, course_id: str, term_id: Optional[str] = None
) -> list[str]:
    """Distinct `YYYY-MM` values for the register's month picker — computed in
    SQL instead of by downloading every session to slice its date string."""
    month = func.substr(AttendanceSession.date, 1, 7)
    stmt = select(month.label("m")).where(AttendanceSession.course_id == course_id)
    if term_id:
        stmt = stmt.where(AttendanceSession.term_id == term_id)
    rows = await db.execute(stmt.group_by(month).order_by(month.desc()))
    return [r[0] for r in rows.all()]


async def _find_session(
    db: AsyncSession, course_id: str, date: str, period: int
) -> Optional[AttendanceSession]:
    # FOR UPDATE: a re-save diffs incoming statuses against stored ones. Two
    # concurrent corrections without a row lock both read the same "before",
    # the later commit silently overwrites the earlier, and its audit entry
    # records a `from` that was already stale.
    res = await db.execute(
        select(AttendanceSession)
        .where(
            AttendanceSession.course_id == course_id,
            AttendanceSession.date == date,
            AttendanceSession.period == period,
        )
        .with_for_update()
    )
    return res.scalar_one_or_none()


# Constraint → message for the attendance writes (see services/util.py).
_SAVE_CONFLICTS = {
    "uq_session_course_date_period": (
        "This class hour was saved by someone else a moment ago — reload and "
        "review it before saving again"
    ),
    "uq_record_session_student": "A student appears twice in this session",
    "attendance_record_student_id_fkey": "One or more students do not exist",
    "attendance_session_course_id_fkey": "Course not found",
    "attendance_session_term_id_fkey": "Term not found",
}


async def save_attendance(
    db: AsyncSession, user: User, payload: SaveAttendancePayload
) -> AttendanceSession:
    """Upsert one class hour. A first save is *marking* (`mark_scope`); a
    re-save of an existing session is a *correction* (`edit_attendance` —
    teachers are first-time only). The permission check lives here, not in the
    router, so no caller can reach the write without it."""
    existing = await _find_session(db, payload.course_id, payload.date, payload.period)
    if existing is None:
        await ensure_can_mark(db, user, payload.course_id, payload.term_id)
    elif not role_capabilities(user.role).edit_attendance:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This session already exists and you cannot edit it",
        )

    if payload.date > today_local().isoformat():
        raise unprocessable("Attendance cannot be marked for a future date")
    if await is_locked_for(db, user, payload.date):
        raise _forbidden_locked()

    now = now_utc()

    if existing is not None:
        # A session is identified by (course, date, period); its term follows
        # from the date. Letting a re-save rewrite term_id would silently move
        # saved attendance out of the term whose summary reports it — an
        # erasure with no deletion, so refuse instead of accepting quietly.
        if existing.term_id != payload.term_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This session was recorded in a different academic term. "
                    "Switch to that term to edit it."
                ),
            )

        # Correction pass: diff incoming against stored records. Every branch
        # below audits: an unlogged mutation on a saved session is exactly the
        # tampering this module exists to make visible.
        prev = {r.student_id: r for r in existing.records}
        incoming_ids = set()
        for inp in payload.records:
            incoming_ids.add(inp.student_id)
            old = prev.get(inp.student_id)
            if old is None:
                # A student who wasn't on the register when it was first saved
                # (late enrolment, corrected roster). Stamped and logged like
                # any other post-hoc change — an unstamped row is
                # indistinguishable from an original mark.
                existing.records.append(
                    AttendanceRecord(
                        id=new_id("arec"),
                        student_id=inp.student_id,
                        status=inp.status,
                        edited_by=user.id,
                        edited_at=now,
                    )
                )
                db.add(
                    make_audit(
                        user.id,
                        AuditActionEnum.EDIT,
                        course_id=payload.course_id,
                        term_id=payload.term_id,
                        date=payload.date,
                        period=payload.period,
                        student_id=inp.student_id,
                        from_status=None,  # no prior record
                        to_status=inp.status,
                        note="Added to a saved session",
                    )
                )
            elif old.status != inp.status:
                from_status = old.status
                old.original_status = old.original_status or old.status
                old.status = inp.status
                old.edited_by = user.id
                old.edited_at = now
                db.add(
                    make_audit(
                        user.id,
                        AuditActionEnum.EDIT,
                        course_id=payload.course_id,
                        term_id=payload.term_id,
                        date=payload.date,
                        period=payload.period,
                        student_id=inp.student_id,
                        from_status=from_status,
                        to_status=inp.status,
                    )
                )
        # Drop stored records for students not in the incoming set.
        #
        # This is the most destructive edit the API allows: it takes the record,
        # its original_status provenance and the student's whole presence in the
        # session. `correction_red_flags` compares original_status against
        # status on *surviving* rows, so a removal is invisible to it — the
        # audit entry below is the only thing that can show it happened. Keep
        # from_status: what the student was marked as is the point.
        for sid, old in prev.items():
            if sid not in incoming_ids:
                db.add(
                    make_audit(
                        user.id,
                        AuditActionEnum.REMOVE_RECORD,
                        course_id=payload.course_id,
                        term_id=payload.term_id,
                        date=payload.date,
                        period=payload.period,
                        student_id=sid,
                        from_status=old.original_status or old.status,
                        to_status=None,  # no record left
                        note="Removed from a saved session",
                    )
                )
                existing.records.remove(old)
        await commit_or_raise(db, _SAVE_CONFLICTS)
        await db.refresh(existing)
        return existing

    # New session.
    session = AttendanceSession(
        id=new_id("att"),
        course_id=payload.course_id,
        term_id=payload.term_id,
        date=payload.date,
        period=payload.period,
        marked_by=user.id,
        marked_at=now,
    )
    for inp in payload.records:
        session.records.append(
            AttendanceRecord(
                id=new_id("arec"), student_id=inp.student_id, status=inp.status
            )
        )
    db.add(session)
    db.add(
        make_audit(
            user.id,
            AuditActionEnum.MARK,
            course_id=payload.course_id,
            term_id=payload.term_id,
            date=payload.date,
            period=payload.period,
            note=f"{len(payload.records)} students",
        )
    )
    await commit_or_raise(db, _SAVE_CONFLICTS)
    await db.refresh(session)
    return session


async def set_attendance_status(
    db: AsyncSession, user: User, session_id: str, student_id: str, new_status
) -> AttendanceSession:
    # Row lock for the same reason as `_find_session`.
    session = await db.get(AttendanceSession, session_id, with_for_update=True)
    if session is None:
        raise not_found("Session not found")
    if await is_locked_for(db, user, session.date):
        raise _forbidden_locked()

    old = next((r for r in session.records if r.student_id == student_id), None)
    if old is not None and old.status == new_status:
        return session  # no-op

    now = now_utc()
    from_status = old.status if old is not None else None
    if old is not None:
        old.original_status = old.original_status or old.status
        old.status = new_status
        old.edited_by = user.id
        old.edited_at = now
    else:
        session.records.append(
            AttendanceRecord(
                id=new_id("arec"),
                student_id=student_id,
                status=new_status,
                edited_by=user.id,
                edited_at=now,
            )
        )
    db.add(
        make_audit(
            user.id,
            AuditActionEnum.EDIT,
            course_id=session.course_id,
            term_id=session.term_id,
            date=session.date,
            period=session.period,
            student_id=student_id,
            from_status=from_status,
            to_status=new_status,
        )
    )
    await commit_or_raise(db, _SAVE_CONFLICTS)
    await db.refresh(session)
    return session


async def delete_session(db: AsyncSession, user: User, session_id: str) -> None:
    session = await db.get(AttendanceSession, session_id)
    if session is None:
        raise not_found("Session not found")
    if await is_locked_for(db, user, session.date):
        raise _forbidden_locked()
    db.add(
        make_audit(
            user.id,
            AuditActionEnum.DELETE_SESSION,
            course_id=session.course_id,
            term_id=session.term_id,
            date=session.date,
            period=session.period,
            note=f"{len(session.records)} records removed",
        )
    )
    await db.delete(session)
    await db.commit()
