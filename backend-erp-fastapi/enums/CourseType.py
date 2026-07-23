from enum import Enum


class CourseTypeEnum(str, Enum):
    CORE = "Core"
    ELECTIVE = "Elective"
    PROFESSIONAL_CORE = "Professional Core"
    PROFESSIONAL_ELECTIVE = "Professional Elective"
    LAB = "Lab"
    OPEN_ELECTIVE = "Open Elective"
    AUDIT = "Audit"
