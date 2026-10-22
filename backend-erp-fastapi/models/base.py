from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def str_enum(enum_cls, name: str, length: int | None = None):
    """A string-backed enum column that stores the enum's *value* strings
    (e.g. "Associate Professor", "attendance-manager") as a plain VARCHAR,
    matching the frontend literals 1:1.

    There is deliberately **no** database CHECK constraint
    (`create_constraint` defaults off): values are validated on every write by
    SQLAlchemy (`validate_strings`) and by the Pydantic schemas, and leaving
    the column unconstrained is what lets a new enum value ship without a
    migration (as `remove-record` did). Only raw SQL can store an unknown value.

    The VARCHAR is sized to the longest value *at table creation* unless
    `length` is given — so a longer value does need a migration. Columns that
    keep growing (audit actions) pin an explicit, roomy `length` instead.
    """
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
        length=length,
    )
