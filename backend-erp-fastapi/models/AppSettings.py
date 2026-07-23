from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models.Repr import Repr

SETTINGS_ID = "singleton"


class AppSettings(Base, Repr):
    """Single-row table holding app-wide state: the current term and lock date
    (the frontend store's `currentTermId` / `lockDate`)."""

    __tablename__ = "app_settings"

    id: Mapped[str] = mapped_column(String(20), primary_key=True, default=SETTINGS_ID)
    current_term_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("academic_term.id", ondelete="SET NULL"), nullable=True
    )
    lock_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)  # ISO yyyy-mm-dd
