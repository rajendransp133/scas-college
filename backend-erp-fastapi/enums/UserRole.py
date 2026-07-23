from enum import Enum


class UserRoleEnum(str, Enum):
    ADMIN = "admin"
    PRINCIPAL = "principal"
    TEACHER = "teacher"
    ATTENDANCE_MANAGER = "attendance-manager"
    HOD = "hod"
    STUDENT_REP = "student-rep"
