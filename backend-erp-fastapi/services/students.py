from __future__ import annotations

from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from enums.UserRole import UserRoleEnum
from ids import new_id
from models import Student, User
from schemas.Student import StudentCreate, StudentUpdate
import services.cache as cache_keys
from services.cache import invalidate
from services.pagination import PageParams, apply_sort, paginate, search_clause
from services.util import apply_updates, conflict, not_found

# API sort field → column. Anything not listed is rejected (falls back to roll).
SORTABLE = {
    "rollNumber": Student.roll_number,
    "name": Student.name,
    "currentSemester": Student.current_semester,
    "admissionYear": Student.admission_year,
    "email": Student.email,
}


def _filtered(
    department_id: Optional[str] = None,
    program_id: Optional[str] = None,
    semester: Optional[int] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    semesters: Optional[list[int]] = None,
):
    """Build the filtered SELECT shared by the list and count paths."""
    stmt = select(Student)
    if department_id:
        stmt = stmt.where(Student.department_id == department_id)
    if program_id:
        stmt = stmt.where(Student.program_id == program_id)
    if semester is not None:
        stmt = stmt.where(Student.current_semester == semester)
    # Set-membership form — lets the parity rule ("which semesters are in
    # session this term") be answered in one query instead of one per semester.
    if semesters:
        stmt = stmt.where(Student.current_semester.in_(semesters))
    if search and search.strip():
        # Trigram-indexed substring match on either identifier.
        stmt = stmt.where(
            or_(*search_clause(search, Student.name, Student.roll_number))
        )
    # "active" means enrolled *and* not yet graduated — the same rule the
    # roster and the shortfall counts use.
    if status == "active":
        stmt = stmt.where(Student.is_active.is_(True), Student.graduated.is_(False))
    elif status == "inactive":
        stmt = stmt.where(Student.is_active.is_(False))
    elif status == "graduated":
        stmt = stmt.where(Student.graduated.is_(True))
    return stmt


async def list_students(
    db: AsyncSession,
    params: PageParams,
    department_id: Optional[str] = None,
    program_id: Optional[str] = None,
    semester: Optional[int] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
    semesters: Optional[list[int]] = None,
    viewer: Optional[User] = None,
    viewer_term_id: Optional[str] = None,
) -> tuple[list[Student], int]:
    """`viewer` bounds the result to that account's read scope. It is applied on
    top of the request filters, never instead of them — a caller narrowing to
    another department gets the intersection (empty), not that department."""
    stmt = _filtered(department_id, program_id, semester, search, status, semesters)
    if viewer is not None:
        from services.scope import apply_student_scope

        stmt = await apply_student_scope(stmt, db, viewer, viewer_term_id)
    stmt = apply_sort(stmt, sort_by, sort_dir, SORTABLE, Student.roll_number)
    items, total = await paginate(db, stmt, params)
    return list(items), total


async def list_student_ids(
    db: AsyncSession,
    department_id: Optional[str] = None,
    program_id: Optional[str] = None,
    semester: Optional[int] = None,
    status: Optional[str] = None,
) -> list[str]:
    """Ids only — for bulk actions (promote/graduate a whole cohort) that need
    the full filtered set without shipping 5000 student bodies to the client."""
    stmt = _filtered(department_id, program_id, semester, None, status).with_only_columns(
        Student.id
    )
    rows = await db.execute(stmt.order_by(Student.roll_number))
    return [r[0] for r in rows.all()]


async def list_roll_numbers(db: AsyncSession) -> list[str]:
    """Every roll number, nothing else.

    The bulk-upload dialog pre-validates a spreadsheet against existing rolls;
    this lets it do that without downloading ~5000 full student records.
    """
    rows = await db.execute(select(Student.roll_number).order_by(Student.roll_number))
    return [r[0] for r in rows.all()]


async def lookup_students(
    db: AsyncSession,
    ids: list[str],
    viewer: Optional[User] = None,
    viewer_term_id: Optional[str] = None,
) -> list[dict]:
    """id → name/roll for a specific set of students.

    Pages that show student *names* against ids they got from somewhere else
    (the audit log, an attendance session) need exactly this and nothing more.
    `viewer` bounds the set to that account's read scope.
    """
    if not ids:
        return []
    stmt = select(Student.id, Student.name, Student.roll_number).where(
        Student.id.in_(ids)
    )
    if viewer is not None:
        from services.scope import apply_student_scope

        stmt = await apply_student_scope(stmt, db, viewer, viewer_term_id)
    rows = await db.execute(stmt)
    return [{"id": r[0], "name": r[1], "rollNumber": r[2]} for r in rows.all()]


async def get_student(db: AsyncSession, student_id: str) -> Student:
    st = await db.get(Student, student_id)
    if st is None:
        raise not_found("Student not found")
    return st


async def create_student(db: AsyncSession, data: StudentCreate) -> Student:
    st = Student(id=new_id("stu"), **data.model_dump(by_alias=False))
    db.add(st)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise conflict("Roll number already exists")
    await db.refresh(st)
    return st


async def update_student(
    db: AsyncSession, student_id: str, data: StudentUpdate
) -> Student:
    st = await get_student(db, student_id)
    apply_updates(st, data)
    await db.commit()
    await db.refresh(st)
    return st


async def delete_student(db: AsyncSession, student_id: str) -> None:
    # Hard delete; attendance records are removed via FK cascade.
    st = await get_student(db, student_id)
    await db.delete(st)
    await db.commit()


async def toggle_active(db: AsyncSession, student_id: str) -> Student:
    st = await get_student(db, student_id)
    st.is_active = not st.is_active
    await db.commit()
    await db.refresh(st)
    return st


# ---------------------------------------------------------------------------
# Class-rep accounts are retired when their class moves on
#
# A student-rep login is a User row pinned to a (program_id, class_semester)
# pair, and that pair is the *entire* scope of what the rep can see — their
# register, their summary, their materials. Promotion moves the students but
# not the account, so without the code below a rep account would keep pointing
# at the semester its class has left. That is not merely a broken page: once
# next year's intake enrols into that semester, the outgoing rep would be
# looking at the new juniors' attendance.
#
# So when a class moves out of a semester in whole, its rep login is deleted.
# The admin then creates a fresh account for the class in its new semester —
# one obvious action, and the rep for a given semester is typically a different
# student anyway. The password rotates every term as a side effect, which is
# what you want for a login a whole class shares.
# ---------------------------------------------------------------------------


async def _fully_vacated(
    db: AsyncSession, moving: list[Student]
) -> set[tuple[str, int]]:
    """Which classes are being emptied by this batch, in whole.

    A rep must not be dragged along when three students out of a forty-student
    cohort are promoted — the class is still sitting in that semester. So the
    test is "every active student in this class is in the batch".

    It has to be answered *before* the semester numbers change, by comparing
    the batch against the roster. Asking "is the semester empty now?"
    afterwards gives the wrong answer for a normal end-of-year roll: promoting
    sems 1-3 together refills sem 2 with sem 1's class, so nothing below the
    top year would ever look empty.
    """
    moving_per_class: dict[tuple[str, int], int] = {}
    for st in moving:
        if st.program_id:
            key = (st.program_id, st.current_semester)
            moving_per_class[key] = moving_per_class.get(key, 0) + 1

    vacated: set[tuple[str, int]] = set()
    for (program_id, semester), moving_count in moving_per_class.items():
        roster = await db.scalar(
            select(func.count())
            .select_from(Student)
            .where(
                Student.program_id == program_id,
                Student.current_semester == semester,
                Student.is_active.is_(True),
                Student.graduated.is_(False),
            )
        )
        if roster == moving_count:
            vacated.add((program_id, semester))
    return vacated


async def _delete_rep_accounts(db: AsyncSession, vacated: set[tuple[str, int]]) -> int:
    """Delete the rep login of each class that has moved out of its semester.

    `vacated` is the set of (program_id, semester) pairs the students left,
    captured before their semester numbers changed. Deleting rather than
    renumbering keeps the invariant trivial — a rep account always describes a
    class that is actually sitting in that semester right now — and leaves the
    admin one obvious follow-up: create the account for the new class.
    """
    removed = 0
    for program_id, semester in vacated:
        rep = await db.scalar(
            select(User).where(
                User.role == UserRoleEnum.STUDENT_REP,
                User.program_id == program_id,
                User.class_semester == semester,
            )
        )
        if rep is None:
            continue  # class never had a rep account — nothing to retire.
        await db.delete(rep)
        removed += 1
    return removed


async def promote_students(db: AsyncSession, ids: list[str]) -> tuple[int, int]:
    """Advance students a semester, retiring the rep login of any class that
    moves out in whole.

    Returns (students promoted, rep accounts removed). Both happen in one
    transaction: a half-applied rollover that moved the cohort but left the old
    login pointing at the vacated semester is exactly the state this prevents.
    """
    if not ids:
        return 0, 0
    rows = await db.execute(select(Student).where(Student.id.in_(ids)))
    moving = [st for st in rows.scalars().all() if st.is_active and not st.graduated]

    # Decide which classes are emptying *before* touching the semester numbers.
    vacated = await _fully_vacated(db, moving)
    for st in moving:
        st.current_semester += 1

    removed = await _delete_rep_accounts(db, vacated)
    count = len(moving)
    await db.commit()
    if removed:
        invalidate(cache_keys.DIRECTORY)
    return count, removed


async def graduate_students(db: AsyncSession, ids: list[str]) -> tuple[int, int]:
    """Graduate students, retiring the rep login of any class that empties.

    Same rule as promotion — the class is gone, so its login goes with it.

    Returns (students graduated, rep accounts removed).
    """
    if not ids:
        return 0, 0
    rows = await db.execute(select(Student).where(Student.id.in_(ids)))
    leaving = list(rows.scalars().all())

    # Only students who actually count towards a roster can vacate a class —
    # re-graduating someone already graduated must not tip the comparison.
    vacated = await _fully_vacated(
        db, [st for st in leaving if st.is_active and not st.graduated]
    )
    for st in leaving:
        st.graduated = True

    removed = await _delete_rep_accounts(db, vacated)
    count = len(leaving)
    await db.commit()
    if removed:
        invalidate(cache_keys.DIRECTORY)
    return count, removed
