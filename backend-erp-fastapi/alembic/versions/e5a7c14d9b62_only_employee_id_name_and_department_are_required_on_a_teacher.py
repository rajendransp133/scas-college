"""only employee id, name and department are required on a teacher

The teacher directory is built from whatever the office has on hand — often a
name, a department and nothing else. The staff list this system was seeded
from carried no phone numbers and no joining dates at all, which forced the
seed to write empty strings into NOT NULL columns and then broke
`GET /teachers` outright: `TeacherResponse.phone` demanded `min_length=1`, so
serialising the list raised a ValidationError and the endpoint 500'd.

Identity (`employee_id`, `name`) and the department placement stay required —
the department is what makes HOD-ship and course assignment meaningful.
Everything else becomes nullable and back-fillable. `designation` is left NOT
NULL because it has a sensible default ("Assistant Professor") the API now
applies, so a caller still never has to supply it.

Widening NOT NULL -> NULL is metadata-only in Postgres; it takes an ACCESS
EXCLUSIVE lock but does not rewrite the table. The downgrade has to invent
values for rows that took advantage of the new nullability, so it backfills
sentinels rather than failing — don't rely on it to round-trip real data.

Revision ID: e5a7c14d9b62
Revises: d4e6f92b1a83
Create Date: 2026-07-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5a7c14d9b62"
down_revision: Union[str, Sequence[str], None] = "d4e6f92b1a83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# column name -> (type, downgrade backfill expression)
_RELAXED: list[tuple[str, sa.types.TypeEngine, str]] = [
    ("email", sa.String(255), "''"),
    ("phone", sa.String(30), "''"),
    ("qualification", sa.String(255), "''"),
    ("joining_date", sa.Date(), "DATE '1970-01-01'"),
]


def upgrade() -> None:
    for name, type_, _ in _RELAXED:
        op.alter_column("teacher", name, existing_type=type_, nullable=True)
    # The seed wrote "" for the phone numbers it didn't have. Now that NULL is
    # available, use it — "no phone on file" and "the empty phone number" are
    # not the same thing, and only NULL renders as "—" in the UI.
    op.execute("UPDATE teacher SET phone = NULL WHERE phone = ''")


def downgrade() -> None:
    for name, type_, backfill in _RELAXED:
        # NOT NULL cannot be re-applied over the nulls this migration allowed.
        op.execute(f"UPDATE teacher SET {name} = {backfill} WHERE {name} IS NULL")
        op.alter_column("teacher", name, existing_type=type_, nullable=False)
