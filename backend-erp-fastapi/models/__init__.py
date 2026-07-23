from models.base import Base
from models.Repr import Repr

from models.Department import Department
from models.Program import Program
from models.Semester import Semester
from models.Course import Course
from models.Student import Student
from models.Teacher import Teacher
from models.AcademicTerm import AcademicTerm
from models.CourseAssignment import CourseAssignment
from models.AttendanceSession import AttendanceSession
from models.AttendanceRecord import AttendanceRecord
from models.AuditEntry import AuditEntry
from models.StudyMaterial import StudyMaterial
from models.User import User
from models.AppSettings import AppSettings, SETTINGS_ID

__all__ = [
    "Base",
    "Repr",
    "Department",
    "Program",
    "Semester",
    "Course",
    "Student",
    "Teacher",
    "AcademicTerm",
    "CourseAssignment",
    "AttendanceSession",
    "AttendanceRecord",
    "AuditEntry",
    "StudyMaterial",
    "User",
    "AppSettings",
    "SETTINGS_ID",
]
