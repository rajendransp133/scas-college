"""account soft-disable + token epoch on app_user

Two columns that together make an outstanding JWT stoppable. `is_active` lets a
departing/suspended account be deactivated instead of deleted (keeping its
audit-actor links); `get_current_user` rejects an inactive login. `token_epoch`
is a per-account generation counter stamped into every JWT — the request path
rejects any token minted before the current value, so a password change or a
disable actually cuts off a token that would otherwise stay valid for its full
12h lifetime.

Both are additive NOT NULL columns with a server default, so existing rows
backfill to `is_active = true` / `token_epoch = 0` without a table rewrite of
user-visible data (app_user is small — staff plus one rep per class).

Revision ID: f6b8d05e3c19
Revises: e5a7c14d9b62
Create Date: 2026-07-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f6b8d05e3c19"
down_revision: Union[str, Sequence[str], None] = "e5a7c14d9b62"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_user",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "app_user",
        sa.Column(
            "token_epoch",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("app_user", "token_epoch")
    op.drop_column("app_user", "is_active")
