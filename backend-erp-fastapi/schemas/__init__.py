from schemas.base import CamelModel
from schemas.Department import (
    DepartmentBase,
    DepartmentCreate,
    DepartmentDetailResponse,
    DepartmentResponse,
    DepartmentUpdate,
)
from schemas.Program import (
    ProgramBase,
    ProgramCreate,
    ProgramDetailResponse,
    ProgramResponse,
    ProgramUpdate,
)
from schemas.Course import CourseCreate, CourseResponse
from schemas.Semester import SemesterCreate, SemesterResponse
from schemas.Teacher import (
    SetHodPayload,
    TeacherBase,
    TeacherCreate,
    TeacherResponse,
    TeacherUpdate,
)
from schemas.Student import (
    IdListPayload,
    StudentBase,
    StudentCreate,
    StudentResponse,
    StudentUpdate,
)
from schemas.Term import SetCurrentTermPayload, TermCreate, TermResponse
from schemas.Assignment import AssignmentCreate, AssignmentResponse
from schemas.Attendance import (
    AttendanceRecordInput,
    AttendanceRecordResponse,
    AttendanceSessionResponse,
    SaveAttendancePayload,
    SetStatusPayload,
)
from schemas.Audit import AuditResponse, LockDatePayload
from schemas.Material import MaterialResponse
from schemas.User import UserBase, UserCreate, UserResponse, UserUpdate
from schemas.Auth import LoginRequest, MeResponse, TokenResponse

__all__ = [
    "CamelModel",
    "DepartmentBase",
    "DepartmentCreate",
    "DepartmentUpdate",
    "DepartmentResponse",
    "DepartmentDetailResponse",
    "ProgramBase",
    "ProgramCreate",
    "ProgramUpdate",
    "ProgramResponse",
    "ProgramDetailResponse",
    "CourseCreate",
    "CourseResponse",
    "SemesterCreate",
    "SemesterResponse",
    "TeacherBase",
    "TeacherCreate",
    "TeacherUpdate",
    "TeacherResponse",
    "SetHodPayload",
    "StudentBase",
    "StudentCreate",
    "StudentUpdate",
    "StudentResponse",
    "IdListPayload",
    "TermCreate",
    "TermResponse",
    "SetCurrentTermPayload",
    "AssignmentCreate",
    "AssignmentResponse",
    "AttendanceRecordInput",
    "AttendanceRecordResponse",
    "AttendanceSessionResponse",
    "SaveAttendancePayload",
    "SetStatusPayload",
    "AuditResponse",
    "LockDatePayload",
    "MaterialResponse",
    "UserBase",
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "LoginRequest",
    "TokenResponse",
    "MeResponse",
]
