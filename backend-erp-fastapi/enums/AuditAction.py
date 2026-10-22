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

    # --- Administrative changes -------------------------------------------
    # Not attendance, but the same question — "who changed this, and when?" —
    # and the same append-only guarantee. They carry no termId (they concern
    # the college, not a term), so the log shows them in every term. The
    # entity's id and a human label go in `note`; `student_id` / `course_id`
    # are filled where the entity is one, so the log's lookups resolve them.

    # Accounts. Password resets by an admin are UPDATE_USER (the note says so);
    # CHANGE_PASSWORD is the self-service path.
    CREATE_USER = "create-user"
    UPDATE_USER = "update-user"
    DELETE_USER = "delete-user"
    CHANGE_PASSWORD = "change-password"

    # Students. Activate/deactivate is UPDATE_STUDENT.
    CREATE_STUDENT = "create-student"
    UPDATE_STUDENT = "update-student"
    DELETE_STUDENT = "delete-student"
    PROMOTE_STUDENTS = "promote-students"
    GRADUATE_STUDENTS = "graduate-students"

    # Teachers. HOD changes are UPDATE_TEACHER.
    CREATE_TEACHER = "create-teacher"
    UPDATE_TEACHER = "update-teacher"
    DELETE_TEACHER = "delete-teacher"

    # Curriculum.
    CREATE_DEPARTMENT = "create-department"
    UPDATE_DEPARTMENT = "update-department"
    DELETE_DEPARTMENT = "delete-department"
    CREATE_PROGRAM = "create-program"
    UPDATE_PROGRAM = "update-program"
    DELETE_PROGRAM = "delete-program"
    CREATE_SEMESTER = "create-semester"
    DELETE_SEMESTER = "delete-semester"
    CREATE_COURSE = "create-course"
    DELETE_COURSE = "delete-course"

    # Teaching assignments and terms.
    ASSIGN_COURSE = "assign-course"
    UNASSIGN_COURSE = "unassign-course"
    CREATE_TERM = "create-term"
    SET_CURRENT_TERM = "set-current-term"
