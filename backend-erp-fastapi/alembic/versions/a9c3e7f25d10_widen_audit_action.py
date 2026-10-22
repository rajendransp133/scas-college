"""widen audit_entry.action to VARCHAR(32)

`str_enum` columns carry no CHECK, so a new audit action normally ships without
a migration — but the VARCHAR itself was sized to the longest value at creation
(`delete-session`, 14 chars). The administrative actions added alongside this
revision (`promote-students`, `delete-department`, `set-current-term`, …) are
longer, so the column is widened to a roomy 32 and the model pins that length.

Widening a VARCHAR is a catalog-only change in Postgres (no table rewrite), so
this is safe on the 224k-row log.

Revision ID: a9c3e7f25d10
Revises: a7d2c4e9f1b3
Create Date: 2026-10-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9c3e7f25d10"
down_revision: Union[str, Sequence[str], None] = "a7d2c4e9f1b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "audit_entry",
        "action",
        existing_type=sa.String(length=14),
        type_=sa.String(length=32),
        existing_nullable=False,
    )


def downgrade() -> None:
    # The audit log is never pruned, not even by a downgrade: if entries using
    # the longer actions exist, refuse rather than delete them. (CI's
    # upgrade→downgrade→upgrade round-trip runs on an empty table.)
    long_rows = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM audit_entry WHERE length(action) > 14")
    )
    if long_rows:
        raise RuntimeError(
            f"{long_rows} audit entries use actions longer than 14 characters; "
            "refusing to narrow audit_entry.action (the log is append-only)"
        )
    op.alter_column(
        "audit_entry",
        "action",
        existing_type=sa.String(length=32),
        type_=sa.String(length=14),
        existing_nullable=False,
    )
