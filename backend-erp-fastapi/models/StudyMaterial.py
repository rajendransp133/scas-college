from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base
from models.Repr import Repr


class StudyMaterial(Base, Repr):
    __tablename__ = "study_material"
    __table_args__ = (
        Index("ix_material_course_term", "course_id", "term_id"),
        Index("ix_material_uploaded_at", text("uploaded_at DESC")),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    course_id: Mapped[str] = mapped_column(
        ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True
    )
    term_id: Mapped[str] = mapped_column(
        ForeignKey("academic_term.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Materials are links, not files: the college shares Drive folders, YouTube
    # lectures and PDFs hosted elsewhere. Nothing is stored in this database but
    # the URL, so there is no blob to defer and no download endpoint.
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    uploaded_by: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
