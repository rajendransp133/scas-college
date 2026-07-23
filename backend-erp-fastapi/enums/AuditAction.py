from enum import Enum


class AuditActionEnum(str, Enum):
    MARK = "mark"
    EDIT = "edit"
    # A single student's record dropped from a session that still exists —
    # distinct from DELETE_SESSION, and the one mutation that used to leave no
    # trace at all. It gets its own action so oversight can filter for it:
    # removing a row erases the correction history the EDIT trail relies on.
    REMOVE_RECORD = "remove-record"
    DELETE_SESSION = "delete-session"
    LOCK = "lock"
    UNLOCK = "unlock"
