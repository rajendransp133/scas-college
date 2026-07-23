"""study materials become links, not files

The college stopped wanting file storage in this database: a material is now a
shared URL (Drive folder, YouTube lecture, hosted PDF) that the browser opens
directly. That removes the `data` LargeBinary column — up to 2 MB per row — and
the three file-metadata columns that described it.

Existing rows are file-backed and have no URL to fall back on, so they are
deleted rather than migrated. Re-run `python seed.py` afterwards for the demo
data. The downgrade restores the columns but not the bytes.

Revision ID: c3d5e81a4f27
Revises: b1f7a3c92e04
Create Date: 2026-07-21

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d5e81a4f27"
down_revision: Union[str, Sequence[str], None] = "b1f7a3c92e04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No link exists for a file-backed row, and `url` is NOT NULL.
    op.execute("DELETE FROM study_material")
    op.add_column(
        "study_material",
        sa.Column("url", sa.String(length=2048), nullable=False),
    )
    op.drop_column("study_material", "data")
    op.drop_column("study_material", "file_size")
    op.drop_column("study_material", "file_type")
    op.drop_column("study_material", "file_name")


def downgrade() -> None:
    op.execute("DELETE FROM study_material")
    op.add_column(
        "study_material",
        sa.Column("file_name", sa.String(length=255), nullable=False),
    )
    op.add_column(
        "study_material",
        sa.Column("file_type", sa.String(length=120), nullable=False),
    )
    op.add_column(
        "study_material", sa.Column("file_size", sa.Integer(), nullable=False)
    )
    op.add_column(
        "study_material", sa.Column("data", sa.LargeBinary(), nullable=False)
    )
    op.drop_column("study_material", "url")
