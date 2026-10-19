"""DB-enforced one-rep-per-class, RESTRICT on term FKs, drop redundant indexes

Revision ID: a7d2c4e9f1b3
Revises: f6b8d05e3c19
Create Date: 2026-10-19

Three things the schema was trusting the application to get right:

1. **One student-rep account per class** was a check-then-insert in
   `services/users.py` over a *plain* index. Two concurrent creates both
   passed the check; once a duplicate existed, every later write for that
   class 500'd (`scalar_one_or_none` → MultipleResultsFound) and rollover
   deleted only one of the pair. Now a partial UNIQUE index. The upgrade
   refuses to run while duplicates exist rather than choosing which login to
   delete — that is the admin's call.
2. **Deleting an academic term cascaded** through every session, assignment
   and material in it. No endpoint deletes a term, so the only way to trigger
   it was a hand-written `DELETE`, which would have erased a term of
   attendance with no audit trail. Now `RESTRICT`. (Added `NOT VALID` then
   validated separately, so validation doesn't block writes on the 200k-row
   session table.)
3. **Eleven single-column indexes were strict prefixes** of a composite or
   unique index on the same table, so they served no query the composite
   doesn't, while costing a write on every insert — two of them on the
   4M-row `attendance_record`. Dropped `CONCURRENTLY`.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a7d2c4e9f1b3"
down_revision: Union[str, Sequence[str], None] = "f6b8d05e3c19"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TERM_FK_TABLES = ("attendance_session", "course_assignment", "study_material")

# (dropped index, table, column, the index that already covers it)
_REDUNDANT = (
    ("ix_attendance_record_session_id", "attendance_record", "session_id", "uq_record_session_student"),
    ("ix_attendance_record_student_id", "attendance_record", "student_id", "ix_record_student_status"),
    ("ix_attendance_session_course_id", "attendance_session", "course_id", "uq_session_course_date_period"),
    ("ix_attendance_session_term_id", "attendance_session", "term_id", "ix_session_term_date_period"),
    ("ix_course_assignment_course_id", "course_assignment", "course_id", "uq_assignment_triple"),
    ("ix_course_assignment_teacher_id", "course_assignment", "teacher_id", "ix_assignment_teacher_term"),
    ("ix_course_assignment_term_id", "course_assignment", "term_id", "ix_assignment_term_course"),
    ("ix_student_department_id", "student", "department_id", "ix_student_dept_program"),
    ("ix_student_program_id", "student", "program_id", "ix_student_program_semester"),
    ("ix_teacher_department_id", "teacher", "department_id", "ix_teacher_dept_name"),
    ("ix_study_material_course_id", "study_material", "course_id", "ix_material_course_term"),
)


def _set_term_fk(ondelete: str) -> None:
    for table in _TERM_FK_TABLES:
        name = f"{table}_term_id_fkey"
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT {name}")
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {name} FOREIGN KEY (term_id) "
            f"REFERENCES academic_term (id) ON DELETE {ondelete} NOT VALID"
        )
        op.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")


def upgrade() -> None:
    dupes = op.get_bind().execute(
        sa.text(
            "SELECT program_id, class_semester, count(*) FROM app_user "
            "WHERE role = 'student-rep' AND program_id IS NOT NULL "
            "AND class_semester IS NOT NULL "
            "GROUP BY program_id, class_semester HAVING count(*) > 1"
        )
    ).all()
    if dupes:
        listed = ", ".join(f"{p} sem {s} ({n} accounts)" for p, s, n in dupes)
        raise RuntimeError(
            "Cannot enforce one student-rep per class: duplicates exist for "
            f"{listed}. Delete the extra accounts in /users, then re-run."
        )
    op.execute("DROP INDEX IF EXISTS ix_user_rep_class")
    op.execute(
        "CREATE UNIQUE INDEX uq_user_rep_class ON app_user (program_id, class_semester) "
        "WHERE role = 'student-rep'"
    )

    _set_term_fk("RESTRICT")

    with op.get_context().autocommit_block():
        for name, *_ in _REDUNDANT:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, column, _ in _REDUNDANT:
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} ({column})"
            )

    _set_term_fk("CASCADE")

    op.execute("DROP INDEX IF EXISTS uq_user_rep_class")
    op.execute(
        "CREATE INDEX ix_user_rep_class ON app_user (program_id, class_semester)"
    )
