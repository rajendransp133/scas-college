"""Server-side aggregation for the read-heavy dashboards.

Every function here answers a question the frontend used to answer by
downloading whole tables (`useAttendance({})` pulled all 202k sessions and
their 4M records to compute a handful of numbers). The attendance maths is the
same as `lib/attendance.ts` — kept in one place, `_TALLY`, so the two sides
cannot drift:

    held      = status is not "od"          (OD is excused, not counted)
    attended  = status in ("present","late")
    pct       = attended / held             (undefined when held == 0)

"as-marked" figures repeat the tally over COALESCE(original_status, status),
which is what the register showed *before* any correction — the delta between
the two is what the oversight page flags.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from enums.AttendanceStatus import AttendanceStatusEnum as St
from enums.AuditAction import AuditActionEnum
from models import (
    AttendanceRecord,
    AttendanceSession,
    Course,
    CourseAssignment,
    AuditEntry,
    Program,
    Semester,
    Student,
    Teacher,
)
from services.pagination import PageParams, search_clause

PRESENT_EQUIVALENT = (St.PRESENT, St.LATE)

# The "as-marked" status: what was originally entered, before any correction.
_ORIGINAL = func.coalesce(
    AttendanceRecord.original_status, AttendanceRecord.status
)

_TALLY = {
    "held": func.count().filter(AttendanceRecord.status != St.OD),
    "attended": func.count().filter(AttendanceRecord.status.in_(PRESENT_EQUIVALENT)),
    "orig_held": func.count().filter(_ORIGINAL != St.OD),
    "orig_attended": func.count().filter(_ORIGINAL.in_(PRESENT_EQUIVALENT)),
    "corrections": func.count().filter(
        AttendanceRecord.original_status.is_not(None)
    ),
}


def _tally_columns():
    return [expr.label(name) for name, expr in _TALLY.items()]


def _scoped_records(
    term_id: Optional[str] = None,
    program_id: Optional[str] = None,
    semester: Optional[int] = None,
    course_id: Optional[str] = None,
    department_id: Optional[str] = None,
) -> Select:
    """records ⋈ sessions ⋈ course ⋈ semester, narrowed to one class/term.

    Scoping runs through the *course's* program/semester (not the student's) so
    a student who has since left or moved on keeps their historical rows — the
    register and summary must never silently drop marks.
    """
    stmt = select(AttendanceRecord.student_id).join(
        AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id
    )
    needs_course = bool(program_id or semester is not None or department_id)
    if course_id:
        stmt = stmt.where(AttendanceSession.course_id == course_id)
    if needs_course:
        stmt = stmt.join(Course, Course.id == AttendanceSession.course_id).join(
            Semester, Semester.id == Course.semester_id
        )
        if program_id:
            stmt = stmt.where(Semester.program_id == program_id)
        if semester is not None:
            stmt = stmt.where(Semester.number == semester)
        if department_id:
            stmt = stmt.join(Program, Program.id == Semester.program_id).where(
                Program.department_id == department_id
            )
    if term_id:
        stmt = stmt.where(AttendanceSession.term_id == term_id)
    return stmt


def _pct(attended: int, held: int) -> Optional[float]:
    """attended/held as a 0–100 float; None when nothing was held.

    Deliberately computed in Python, not SQL: Postgres has no
    `round(double precision, int)`, and every filter that needs to *compare*
    a percentage does so as `attended * 100 <=> min_pct * held`, which stays
    in integer/numeric arithmetic and needs no rounding at all.
    """
    return round(100.0 * attended / held, 2) if held else None


async def student_summary(
    db: AsyncSession,
    params: PageParams,
    term_id: Optional[str] = None,
    program_id: Optional[str] = None,
    semester: Optional[int] = None,
    course_id: Optional[str] = None,
    course_ids: Optional[list[str]] = None,
    department_id: Optional[str] = None,
    search: Optional[str] = None,
    min_pct: float = 75.0,
    defaulters_only: bool = False,
    allowed_course_ids: Optional[set[str]] = None,
) -> tuple[list[dict], int, dict]:
    """One row per student: held/attended/pct plus the as-marked comparison.

    Returns (rows, total, totals) where `totals` covers the whole filtered set,
    not just the page — the page header needs counts it can't derive from 25 rows.

    `allowed_course_ids` is the caller's read scope (`services/scope.py`), `None`
    for unrestricted. It is a separate argument from `course_ids` — that one is
    the user's own filter, this one is the ceiling on it — so a narrower filter
    can never widen the scope.
    """
    if allowed_course_ids is not None and not allowed_course_ids:
        return [], 0, {
            "students": 0,
            "defaulters": 0,
            "held": 0,
            "attended": 0,
            "pct": None,
        }

    agg = (
        _scoped_records(term_id, program_id, semester, course_id, department_id)
        .add_columns(*_tally_columns())
        .group_by(AttendanceRecord.student_id)
    )
    if course_ids:
        agg = agg.where(AttendanceSession.course_id.in_(course_ids))
    if allowed_course_ids is not None:
        agg = agg.where(AttendanceSession.course_id.in_(allowed_course_ids))
    agg = agg.cte("agg")

    stmt = select(
        Student.id,
        Student.roll_number,
        Student.name,
        Student.program_id,
        Student.current_semester,
        Student.is_active,
        Student.graduated,
        agg.c.held,
        agg.c.attended,
        agg.c.corrections,
        agg.c.orig_held,
        agg.c.orig_attended,
    ).join(agg, agg.c.student_id == Student.id)

    if search and search.strip():
        stmt = stmt.where(
            or_(*search_clause(search, Student.name, Student.roll_number))
        )
    if defaulters_only:
        # Integer-safe form of `pct < min_pct`; students with nothing held are
        # not defaulters (no classes were conducted for them).
        stmt = stmt.where(
            and_(agg.c.held > 0, agg.c.attended * 100.0 < min_pct * agg.c.held)
        )

    # Count and totals come from one pass over the same filtered set, so the
    # header can never disagree with the rows (a search narrows both) and the
    # expensive aggregate is scanned twice, not three times.
    filtered = stmt.order_by(None).subquery()
    summary_row = (
        await db.execute(
            select(
                func.count().label("students"),
                func.count()
                .filter(
                    and_(
                        filtered.c.held > 0,
                        filtered.c.attended * 100.0 < min_pct * filtered.c.held,
                    )
                )
                .label("defaulters"),
                func.coalesce(func.sum(filtered.c.held), 0).label("held"),
                func.coalesce(func.sum(filtered.c.attended), 0).label("attended"),
            ).select_from(filtered)
        )
    ).one()
    total = int(summary_row.students)
    totals = {
        "students": total,
        "defaulters": int(summary_row.defaulters),
        "held": int(summary_row.held),
        "attended": int(summary_row.attended),
        "pct": _pct(int(summary_row.attended), int(summary_row.held)),
    }

    rows = await db.execute(
        stmt.order_by(Student.roll_number)
        .limit(params.page_size)
        .offset(params.offset)
    )
    items = [
        {
            "studentId": r.id,
            "rollNumber": r.roll_number,
            "name": r.name,
            "programId": r.program_id,
            "currentSemester": r.current_semester,
            "isActive": r.is_active,
            "graduated": r.graduated,
            "held": r.held,
            "attended": r.attended,
            "pct": _pct(r.attended, r.held),
            "origHeld": r.orig_held,
            "origAttended": r.orig_attended,
            "origPct": _pct(r.orig_attended, r.orig_held),
            "corrections": r.corrections,
        }
        for r in rows.all()
    ]

    return items, total, totals


async def student_course_breakdown(
    db: AsyncSession, student_id: str, term_id: Optional[str] = None
) -> list[dict]:
    """Per-course tally for one student — the summary expand row and the
    student detail page's attendance card."""
    stmt = (
        select(AttendanceSession.course_id, *_tally_columns())
        .select_from(AttendanceRecord)
        .join(AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id)
        .where(AttendanceRecord.student_id == student_id)
        .group_by(AttendanceSession.course_id)
    )
    if term_id:
        stmt = stmt.where(AttendanceSession.term_id == term_id)
    rows = await db.execute(stmt)
    return [
        {
            "courseId": r.course_id,
            "held": r.held,
            "attended": r.attended,
            "pct": _pct(r.attended, r.held),
            "origHeld": r.orig_held,
            "origAttended": r.orig_attended,
            "origPct": _pct(r.orig_attended, r.orig_held),
            "corrections": r.corrections,
        }
        for r in rows.all()
    ]


async def shortfall_count(
    db: AsyncSession,
    term_id: Optional[str] = None,
    department_id: Optional[str] = None,
    min_pct: float = 75.0,
) -> int:
    """How many *currently enrolled* students are below the threshold.

    Left/graduated students keep their history but are excluded from this
    count — the dashboard card is about who still needs chasing.
    """
    agg = (
        _scoped_records(term_id=term_id, department_id=department_id)
        .add_columns(*_tally_columns())
        .group_by(AttendanceRecord.student_id)
        .cte("agg")
    )
    stmt = (
        select(func.count())
        .select_from(agg)
        .join(Student, Student.id == agg.c.student_id)
        .where(
            Student.is_active.is_(True),
            Student.graduated.is_(False),
            agg.c.held > 0,
            agg.c.attended * 100.0 < min_pct * agg.c.held,
        )
    )
    return (await db.execute(stmt)).scalar_one()


async def correction_red_flags(
    db: AsyncSession, term_id: Optional[str] = None, min_pct: float = 75.0
) -> dict:
    """The two oversight cards.

    `passingOnlyViaCorrections` — students whose as-marked attendance was below
    the threshold but whose corrected attendance clears it. That pattern is the
    whole reason this system exists, so it is computed exactly, in SQL.
    """
    agg = (
        _scoped_records(term_id=term_id)
        .add_columns(*_tally_columns())
        .group_by(AttendanceRecord.student_id)
        .cte("agg")
    )
    suspicious = await db.execute(
        select(
            Student.id,
            Student.name,
            Student.roll_number,
            agg.c.held,
            agg.c.attended,
            agg.c.orig_held,
            agg.c.orig_attended,
            agg.c.corrections,
        )
        .join(Student, Student.id == agg.c.student_id)
        .where(
            agg.c.corrections > 0,
            agg.c.held > 0,
            agg.c.orig_held > 0,
            # as-marked below the bar, corrected above it
            agg.c.orig_attended * 100.0 < min_pct * agg.c.orig_held,
            agg.c.attended * 100.0 >= min_pct * agg.c.held,
        )
        .order_by(agg.c.corrections.desc())
        .limit(50)
    )
    flagged = [
        {
            "studentId": r.id,
            "name": r.name,
            "rollNumber": r.roll_number,
            "held": r.held,
            "attended": r.attended,
            "pct": _pct(r.attended, r.held),
            "origPct": _pct(r.orig_attended, r.orig_held),
            "corrections": r.corrections,
        }
        for r in suspicious.all()
    ]

    by_user_stmt = (
        select(AuditEntry.user_id, func.count().label("n"))
        .where(AuditEntry.action == AuditActionEnum.EDIT)
        .group_by(AuditEntry.user_id)
        .order_by(func.count().desc())
        .limit(20)
    )
    if term_id:
        by_user_stmt = by_user_stmt.where(AuditEntry.term_id == term_id)
    by_user = await db.execute(by_user_stmt)

    return {
        "passingOnlyViaCorrections": flagged,
        "correctionsByUser": [
            {"userId": r.user_id, "corrections": r.n} for r in by_user.all()
        ],
    }


async def dashboard_stats(
    db: AsyncSession,
    term_id: Optional[str] = None,
    department_id: Optional[str] = None,
    min_pct: float = 75.0,
) -> dict:
    """Every dashboard counter in a handful of aggregate queries.

    `department_id` scopes the whole payload for HODs.
    """
    today = date.today().isoformat()
    # When the edit was *made*, not which day's register it touched. AuditEntry
    # carries both: `at` is the timestamp, `date` is the attendance date being
    # corrected. Filtering on `date` counted "corrections to sessions held this
    # week" and so hid the case the card exists to surface — someone reaching
    # back to rewrite an old register today. `ix_audit_at` indexes this.
    edited_since = datetime.now(timezone.utc) - timedelta(days=7)

    # --- headline entity counts ---
    student_q = select(func.count()).select_from(Student).where(
        Student.is_active.is_(True), Student.graduated.is_(False)
    )
    teacher_q = select(func.count()).select_from(Teacher)
    program_q = select(func.count()).select_from(Program)
    if department_id:
        student_q = student_q.where(Student.department_id == department_id)
        teacher_q = teacher_q.where(Teacher.department_id == department_id)
        program_q = program_q.where(Program.department_id == department_id)

    students = (await db.execute(student_q)).scalar_one()
    teachers = (await db.execute(teacher_q)).scalar_one()
    programs = (await db.execute(program_q)).scalar_one()

    # --- session activity in the current term ---
    sessions_q = select(func.count()).select_from(AttendanceSession)
    today_q = sessions_q.where(AttendanceSession.date == today)
    if term_id:
        sessions_q = sessions_q.where(AttendanceSession.term_id == term_id)
        today_q = today_q.where(AttendanceSession.term_id == term_id)
    if department_id:
        dept_courses = (
            select(Course.id)
            .join(Semester, Semester.id == Course.semester_id)
            .join(Program, Program.id == Semester.program_id)
            .where(Program.department_id == department_id)
        )
        sessions_q = sessions_q.where(AttendanceSession.course_id.in_(dept_courses))
        today_q = today_q.where(AttendanceSession.course_id.in_(dept_courses))

    sessions_this_term = (await db.execute(sessions_q)).scalar_one()
    sessions_today = (await db.execute(today_q)).scalar_one()

    # --- integrity signals ---
    corrections_q = select(func.count()).select_from(AuditEntry).where(
        AuditEntry.action == AuditActionEnum.EDIT, AuditEntry.at >= edited_since
    )
    if term_id:
        corrections_q = corrections_q.where(AuditEntry.term_id == term_id)
    corrections_this_week = (await db.execute(corrections_q)).scalar_one()

    shortfall = await shortfall_count(db, term_id, department_id, min_pct)

    return {
        "students": students,
        "teachers": teachers,
        "programs": programs,
        "sessionsThisTerm": sessions_this_term,
        "sessionsToday": sessions_today,
        "correctionsThisWeek": corrections_this_week,
        "shortfall": shortfall,
    }


async def unstaffed_courses(
    db: AsyncSession, term_id: str, parity_numbers: Optional[list[int]] = None
) -> list[dict]:
    """In-session courses with no teacher assigned this term.

    `parity_numbers` are the semester numbers in session for the term's parity
    (odd → 1,3,5…). Passed in rather than derived so the parity rule keeps a
    single definition on the client.
    """
    assigned = select(CourseAssignment.course_id).where(
        CourseAssignment.term_id == term_id
    )
    stmt = (
        select(
            Course.id,
            Course.name,
            Course.code,
            Semester.number,
            Semester.program_id,
        )
        .join(Semester, Semester.id == Course.semester_id)
        .where(Course.id.not_in(assigned))
    )
    if parity_numbers:
        stmt = stmt.where(Semester.number.in_(parity_numbers))
    rows = await db.execute(stmt.order_by(Semester.program_id, Semester.number))
    return [
        {
            "courseId": r.id,
            "name": r.name,
            "code": r.code,
            "semesterNumber": r.number,
            "programId": r.program_id,
        }
        for r in rows.all()
    ]
