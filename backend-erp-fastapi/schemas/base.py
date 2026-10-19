from datetime import date
from typing import Annotated, Any, ClassVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base schema: snake_case in Python, camelCase in JSON (matching the
    frontend TS types). Accepts either casing on input."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


def _real_date(value: str) -> str:
    # The regex alone accepted `2026-02-31` and `2026-13-45`; dates are stored
    # as ISO strings and compared lexicographically (the lock guard), so a
    # value that isn't a real calendar date has to stop at the boundary.
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{value!r} is not a valid calendar date") from None
    return value


# An ISO `YYYY-MM-DD` string that is also a real date.
IsoDate = Annotated[
    str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(_real_date)
]


class UpdateModel(CamelModel):
    """Base for partial-update (`PUT`) payloads.

    Omitting a field leaves it unchanged; sending it as `null` clears it. That
    second half is only legal for columns that are actually nullable — `null`
    for a NOT NULL column used to reach the database and come back as a 500.
    Subclasses list those columns in `NOT_NULL`, and an explicit `null` for any
    of them is a 422 here instead.
    """

    NOT_NULL: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _reject_null_for_required(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulled = []
            for name in cls.NOT_NULL:
                field = cls.model_fields[name]
                keys = {name, field.alias or name}
                if any(k in data and data[k] is None for k in keys):
                    nulled.append(field.alias or name)
            if nulled:
                raise ValueError(f"{', '.join(sorted(nulled))} cannot be null")
        return data
