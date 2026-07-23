"""ID generation mirroring the frontend `newId(prefix)` (prefix + short hex)."""

import uuid


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"
