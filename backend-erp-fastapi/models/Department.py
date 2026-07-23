from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base
from models.Repr import Repr


class Department(Base, Repr):
    __tablename__ = "department"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)

    # lazy="raise": listing departments must never pull the whole curriculum
    # behind it. The one endpoint that needs these (GET /departments/{id})
    # asks for them explicitly with selectinload. Deletes still cascade — the
    # FKs are ON DELETE CASCADE and passive_deletes leaves that to the DB.
    programs: Mapped[list["Program"]] = relationship(
        back_populates="department",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="raise",
    )
    teachers: Mapped[list["Teacher"]] = relationship(
        back_populates="department",
        passive_deletes=True,
        lazy="raise",
    )
