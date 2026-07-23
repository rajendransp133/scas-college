"""only roll number, name and class are required on a student

Admissions staff enrol students before the paperwork catches up: on intake day
there is often a roll number and a name and nothing else. Everything except the
identity pair and the class-placement trio (department/program/semester, which
decide the attendance roster) becomes nullable and back-fillable.

Widening NOT NULL → NULL is metadata-only in Postgres; it takes an ACCESS
EXCLUSIVE lock but does not rewrite the table, so this is fast even on the
large seed. The downgrade is the risky direction — it has to invent values for
any row that took advantage of the new nullability, so it backfills sentinels
rather than failing. Don't rely on it to round-trip real data.

Revision ID: d4e6f92b1a83
Revises: c3d5e81a4f27
Create Date: 2026-07-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e6f92b1a83"
down_revision: Union[str, Sequence[str], None] = "c3d5e81a4f27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# column name → (type, downgrade backfill expression)
_RELAXED: list[tuple[str, sa.types.TypeEngine, str]] = [
    ("email", sa.String(255), "''"),
    ("phone", sa.String(30), "''"),
    ("address", sa.String(255), "''"),
    ("date_of_birth", sa.Date(), "DATE '1970-01-01'"),
    ("gender", sa.String(16), "'other'"),
    ("admission_year", sa.Integer(), "1970"),
    ("guardian_name", sa.String(100), "''"),
    ("guardian_relation", sa.String(40), "''"),
    ("guardian_phone", sa.String(30), "''"),
]


def upgrade() -> None:
    for name, type_, _ in _RELAXED:
        op.alter_column("student", name, existing_type=type_, nullable=True)


def downgrade() -> None:
    for name, type_, backfill in _RELAXED:
        # NOT NULL cannot be re-applied over the nulls this migration allowed.
        op.execute(
            f"UPDATE student SET {name} = {backfill} WHERE {name} IS NULL"
        )
        op.alter_column("student", name, existing_type=type_, nullable=False)
