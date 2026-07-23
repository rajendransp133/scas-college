from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def str_enum(enum_cls, name: str):
    """A string-backed enum column that stores the enum's *value* strings
    (e.g. "Associate Professor", "attendance-manager") as VARCHAR + CHECK,
    matching the frontend literals 1:1."""
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )
