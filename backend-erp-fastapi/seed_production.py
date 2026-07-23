"""Production seed — the real SCAS college structure, no demo data.

Installs the college as it actually is (source: scascollege.ac.in +
the faculty list provided by the office):

- 13 departments, 19 programs (13 UG, 6 PG) with their semesters
- 43 real teachers with their department, HOD flag and qualifications
- the academic term 2026-2027 (Odd), set as the current term
- login accounts: one per teacher (role `hod` for department heads,
  `teacher` otherwise) and one class-rep account per class running this
  odd term (semesters 1/3/5 of every UG program, 1/3 of every PG program)
- a `principal` account only if none exists yet (password from
  PRINCIPAL_PASSWORD, otherwise random)
- an `admin` account only if none exists yet (password from ADMIN_PASSWORD,
  otherwise random)

Every password is randomly generated and written — together with the login
email — to `seed_credentials.csv` next to this script (override the path
with CREDENTIALS_FILE). Distribute them, then tell everyone to change
their password after first login. The CSV is gitignored; delete it once
distributed.

Unlike the old demo seeds this script is production-safe: it never deletes
anything, and it refuses to run against a database that already has
departments/teachers/users beyond the admin — so it cannot clobber live
data on a re-run. To start over in dev, run `python reset_db.py` first.

Students come from `students.csv` next to this script (override with
STUDENTS_FILE) — the real roster, generated from the college's attendance
spreadsheets by `tools/build_students_csv.py`. The file is gitignored, and a
missing one is not an error: the seed just runs without students, and they can
be loaded later through the Students page's bulk-upload dialog, which takes the
very same CSV.

Courses and attendance are still not seeded: the spreadsheets are class-level
registers with no subject data, so subjects remain real data the admin enters
through the app.

Run:  python seed_production.py
"""

from __future__ import annotations

import asyncio
import csv
import os
import secrets
from datetime import date

from sqlalchemy import func, select

from database.connection import async_session, engine
from enums.Designation import DesignationEnum
from enums.Gender import GenderEnum
from enums.Level import LevelEnum
from enums.TermParity import TermParityEnum
from enums.UserRole import UserRoleEnum
from models import (
    AcademicTerm,
    AppSettings,
    Department,
    Program,
    Semester,
    Student,
    Teacher,
    User,
)
from models.AppSettings import SETTINGS_ID
from security import hash_password

TERM_ID = "term-2026-odd"
TERM_NAME = "2026-2027 (Odd)"

ADMIN_EMAIL = "admin@scascollege.ac.in"

PRINCIPAL_EMAIL = "principal@scascollege.ac.in"
PRINCIPAL_NAME = "Principal"

CREDENTIALS_FILE = os.getenv(
    "CREDENTIALS_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_credentials.csv"),
)

# The real student roster, generated from the college's spreadsheets by
# `tools/build_students_csv.py`. Gitignored (names + register numbers), but the
# .dockerignore deliberately lets it into the image so a container seed finds
# it. Absent is not an error — see load_students().
STUDENTS_FILE = os.getenv(
    "STUDENTS_FILE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "students.csv"),
)

# Teachers arrived without joining dates; the term start stands in until the
# office supplies real ones (editable in the app).
PLACEHOLDER_JOINING = "2026-06-01"

# ---------------------------------------------------------------------------
# Departments  (id, name, code) — from the college site's department grid.
# ---------------------------------------------------------------------------
DEPARTMENTS = [
    ("dept-tamil", "Tamil", "TAM"),
    ("dept-eng", "English", "ENG"),
    ("dept-math", "Mathematics", "MAT"),
    ("dept-phy", "Physics", "PHY"),
    ("dept-chem", "Chemistry", "CHE"),
    ("dept-cs", "Computer Science", "CS"),
    ("dept-ca", "Computer Applications", "CA"),
    ("dept-com", "Commerce", "COM"),
    ("dept-com-ca", "Commerce (C.A.)", "COM-CA"),
    ("dept-ba", "Business Administration", "BA"),
    ("dept-pe", "Physical Education", "PE"),
    ("dept-ft", "Fashion Technology", "FT"),
    ("dept-ds", "Defence Studies", "DS"),
]

# ---------------------------------------------------------------------------
# Programs  (key, name, code, level, department, semester count)
# 3-year programs → 6 semesters, 2-year PG → 4. The site also lists a
# Ph.D. Mathematics; deliberately not seeded (research scholars don't run
# through class rosters/attendance) — add it through the app if ever needed.
# ---------------------------------------------------------------------------
PROGRAMS = [
    ("ba-tamil", "B.A. Tamil Literature", "BA-TAM", "UG", "dept-tamil", 6),
    ("ba-eng", "B.A. English", "BA-ENG", "UG", "dept-eng", 6),
    ("ma-eng", "M.A. English", "MA-ENG", "PG", "dept-eng", 4),
    ("bsc-math", "B.Sc. Mathematics", "BSC-MAT", "UG", "dept-math", 6),
    ("msc-math", "M.Sc. Mathematics", "MSC-MAT", "PG", "dept-math", 4),
    ("bsc-phy", "B.Sc. Physics", "BSC-PHY", "UG", "dept-phy", 6),
    ("msc-phy", "M.Sc. Physics", "MSC-PHY", "PG", "dept-phy", 4),
    ("bsc-chem", "B.Sc. Chemistry", "BSC-CHE", "UG", "dept-chem", 6),
    ("bsc-cs", "B.Sc. Computer Science", "BSC-CS", "UG", "dept-cs", 6),
    ("msc-cs", "M.Sc. Computer Science", "MSC-CS", "PG", "dept-cs", 4),
    ("bca", "B.C.A.", "BCA", "UG", "dept-ca", 6),
    ("bcom", "B.Com", "BCOM", "UG", "dept-com", 6),
    ("bcom-ca", "B.Com C.A.", "BCOM-CA", "UG", "dept-com-ca", 6),
    ("mcom", "M.Com", "MCOM", "PG", "dept-com", 4),
    ("bba", "B.B.A.", "BBA", "UG", "dept-ba", 6),
    ("mba", "MBA", "MBA", "PG", "dept-ba", 4),
    ("bsc-ft", "B.Sc. Fashion Technology and Costume Designing", "BSC-FT", "UG", "dept-ft", 6),
    ("bsc-pe", "B.Sc. Physical Education, Health Education and Sports", "BSC-PE", "UG", "dept-pe", 6),
    ("ba-ds", "B.A. Defence and Strategic Studies", "BA-DS", "UG", "dept-ds", 6),
]

LEVEL = {"UG": LevelEnum.UG, "PG": LevelEnum.PG, "PhD": LevelEnum.PhD}

# ---------------------------------------------------------------------------
# Teachers  (name, email, department, qualification, is_hod)
# From the faculty profiles list. Emails are normalised (spaces stripped,
# lowercased, obvious typos like "g.mail.com" fixed). Data notes:
# - Commerce and Commerce (C.A.) are separate departments, exactly as the
#   faculty list has them — Mr. G. Domani heads Commerce, Dr. G. Aparna
#   heads Commerce (C.A.).
# - English listed no head; the department is seeded without an HOD.
# ---------------------------------------------------------------------------
TEACHERS = [
    # Tamil
    ("S. Muthalagan", "smuthalagan2011@gmail.com", "dept-tamil", "M.A., M.Phil., SET", True),
    ("Dr. S. Sudha", "semmozhisudha4@gmail.com", "dept-tamil", "M.A., M.Phil., Ph.D., SET, NET", False),
    ("A. Murugesan", "munnaalagar901@gmail.com", "dept-tamil", "M.A., M.Ed., M.Phil., SET", False),
    ("Dr. R. Snehalatha", "snehalathasubbiah@gmail.com", "dept-tamil", "M.A., M.Phil., M.Ed., Ph.D., SET", False),
    # English (no HOD in the supplied list)
    ("A. Marimuthu", "marimuthu85337@gmail.com", "dept-eng", "M.A., M.Phil., B.Ed.", False),
    ("Mrs. N. Jarina Begam", "njerina91@gmail.com", "dept-eng", "M.A., M.Phil., B.Ed., PGDCA", False),
    ("Mrs. M. Malathy", "vetrimahima@gmail.com", "dept-eng", "M.A., M.Phil., B.Ed.", False),
    # Mathematics
    ("Mr. R. Beemarajan", "rbeemarajan@gmail.com", "dept-math", "M.Sc., B.Ed., M.Phil.", True),
    ("Mrs. P. Alagammal", "hashisabha@gmail.com", "dept-math", "M.Sc., M.Phil., B.Ed.", False),
    ("Mrs. A. Jayalakshmi", "selvakumarjaya001@gmail.com", "dept-math", "M.Sc., M.Phil., B.Ed.", False),
    ("Ms. M. Viji", "viji000pdkt@gmail.com", "dept-math", "M.Sc., B.Ed.", False),
    # Physics
    ("M. Ananthi", "sowndharyam85@gmail.com", "dept-phy", "M.Sc., M.Phil., B.Ed.", True),
    ("M. Bharathapriya", "bharathapriya62116@gmail.com", "dept-phy", "M.Sc., M.Phil.", False),
    # Chemistry
    ("Dr. M. Raja", "rajaudc88@gmail.com", "dept-chem", "M.Sc., D.O.A., Ph.D.", True),
    ("Dr. S. Selvam", "selvams4771@gmail.com", "dept-chem", "M.Sc., M.Phil., B.Ed., Ph.D.", False),
    ("Mrs. B. Sharmila Devi", "sharmilakj11@gmail.com", "dept-chem", "M.Sc., M.Phil., B.Ed.", False),
    # Computer Science
    ("M. Nagalakshmi", "mnagalakshmi9218@gmail.com", "dept-cs", "M.Sc., M.Phil., ADDP", True),
    ("B. Praveen", "dhaprasan@gmail.com", "dept-cs", "M.Sc.", False),
    ("G. Malathi", "malathimalathi934431@gmail.com", "dept-cs", "M.Sc., B.Ed.", False),
    ("A. Thandeeswari", "thandeeswari22@gmail.com", "dept-cs", "M.Sc.", False),
    # Computer Applications (BCA)
    ("S. Kavitha", "profkavitha25@gmail.com", "dept-ca", "MCA, M.Phil., PGDCA", True),
    ("C. Saranya", "c.saranyananya@gmail.com", "dept-ca", "MCA", False),
    ("S. Rama", "ramamca81@gmail.com", "dept-ca", "MCA", False),
    # Commerce
    ("Mr. G. Domani", "domani1983@gmail.com", "dept-com", "M.Com., B.Ed., M.Phil.", True),
    ("Mr. S. Akash", "ajiakash171098@gmail.com", "dept-com", "M.Com., B.Ed., M.Phil.", False),
    ("Mrs. Raghmathunisha", "ragumathu@gmail.com", "dept-com", "M.Com., MBA, M.Phil.", False),
    # Commerce (C.A.)
    ("Dr. G. Aparna", "apuganesh6@gmail.com", "dept-com-ca", "M.Com., Ph.D.", True),
    ("Mrs. P. Keerthika", "keerthitk17@gmail.com", "dept-com-ca", "M.Com., B.Ed., M.Phil.", False),
    ("Mrs. M. Deepa", "deepaakilesh@gmail.com", "dept-com-ca", "M.Com., M.Phil.", False),
    # Business Administration (Management Studies)
    ("P. Deeparani", "ranideepa784@gmail.com", "dept-ba", "M.Com., M.Phil., B.Ed.", True),
    ("S. Kalaivani", "kalaivani678@gmail.com", "dept-ba", "MBA, M.Phil.", False),
    ("R. Shanthi", "sharvinkani@gmail.com", "dept-ba", "M.Com., M.Phil., B.Ed.", False),
    ("M. Uma", "uma.kv12@gmail.com", "dept-ba", "M.A., M.Phil., Ph.D.", False),
    ("D. Gunavathy", "gunavathy735@gmail.com", "dept-ba", "M.Com., M.Phil.", False),
    ("C. Ambika", "ambika.21101990@gmail.com", "dept-ba", "MBA", False),
    # Physical Education
    ("Dr. V. Balasubramanian", "balapdmanavai@gmail.com", "dept-pe", "B.Sc., B.P.Ed., M.P.Ed., M.Phil., Ph.D.", True),
    ("S. Sabareeshwaran", "wfabk@gmail.com", "dept-pe", "B.P.Ed.", False),
    ("R. Kalidass", "kalidass@gmail.com", "dept-pe", "B.P.Ed.", False),
    ("G. Muthumani", "muthumani73662@gmail.com", "dept-pe", "B.P.Ed.", False),
    # Fashion Technology
    ("Mrs. S. Jainisha", "jainisha.s17@gmail.com", "dept-ft", "M.Sc. Fashion Technology and Costume Designing", True),
    ("Ms. M. Gayathri", "ggayu14122001@gmail.com", "dept-ft", "B.Sc. Fashion Technology and Costume Designing", False),
    # Defence Studies
    ("R. R. Kavinnishesh", "kavinnisheshr@gmail.com", "dept-ds", "M.A. Defence and Strategic Studies, M.B.A. (pursuing)", True),
    ("B. Kiruthiga", "kiruthigabharathi@gmail.com", "dept-ds", "M.A. Defence and Strategic Studies, Dip. Cyber Security", False),
]

_PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789"


def make_password(length: int = 10) -> str:
    """Random, unambiguous (no 0/O/1/l/I/B/8 confusion), CSV-safe."""
    return "".join(secrets.choice(_PW_ALPHABET) for _ in range(length))


def rep_semesters(level: str, sem_count: int) -> list[int]:
    """Classes running in an odd term: semesters 1/3/5 as the program allows."""
    if level == "PhD":
        return []  # research scholars — no class rosters/rep logins
    return [n for n in range(1, sem_count + 1) if n % 2 == 1]


# Codes -> seeded ids, derived from the tables above rather than restated, so a
# program can never be renamed in one place and missed in the other.
DEPT_ID_BY_CODE = {code.upper(): dept_id for dept_id, _, code in DEPARTMENTS}
PROG_BY_CODE = {
    code.upper(): (f"prog-{key}", dept_id)
    for key, _, code, _, dept_id, _ in PROGRAMS
}

_REQUIRED_COLUMNS = (
    "rollnumber", "name", "departmentcode", "programcode", "currentsemester",
)


def _blank_to_none(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def load_students() -> list[dict]:
    """Parse students.csv into ready-to-construct Student kwargs.

    Pure — touches no database, so it can run before a session is open and fail
    with nothing half-written.

    Every problem is collected and reported together rather than raising on the
    first: one run should tell the office everything wrong with the file.

    Note this is stricter than the frontend's bulk-upload dialog, which skips
    bad rows and shows a human the tally. Nobody is watching this one — it runs
    unattended inside the `bootstrap` container behind `|| echo skipped` — and a
    quietly dropped row becomes a student missing from a register that nobody
    notices until they can't be marked present in week six.
    """
    if not os.path.exists(STUDENTS_FILE):
        print(
            f"No students.csv at {STUDENTS_FILE} — seeding without students. "
            "Generate it with tools/build_students_csv.py, or bulk-upload it "
            "from the Students page once the app is running."
        )
        return []

    # utf-8-sig, not utf-8: tolerant of a file that has been round-tripped
    # through Excel (which adds a BOM) as well as our own BOM-less output.
    with open(STUDENTS_FILE, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        headers = {(h or "").strip().lower(): h for h in (reader.fieldnames or [])}
        missing = [c for c in _REQUIRED_COLUMNS if c not in headers]
        if missing:
            raise RuntimeError(
                f"{STUDENTS_FILE} is missing required column(s): "
                f"{', '.join(missing)}"
            )
        rows = list(reader)

    def cell(row: dict, key: str) -> str:
        return (row.get(headers.get(key, ""), "") or "").strip()

    students: list[dict] = []
    errors: list[str] = []
    seen: dict[str, int] = {}

    for i, row in enumerate(rows, start=2):  # header is line 1
        roll, name = cell(row, "rollnumber"), cell(row, "name")
        if not roll and not name:
            continue
        if not roll or not name:
            errors.append(f"line {i}: rollNumber and name are both required")
            continue
        # Never truncate a roll number to fit: it is the student's identity and
        # a shortened one could collide with somebody else's.
        if len(roll) > 40:
            errors.append(f"line {i}: rollNumber is {len(roll)} chars (max 40)")
            continue
        if len(name) > 100:
            errors.append(f"line {i}: name is {len(name)} chars (max 100)")
            continue
        if roll in seen:
            errors.append(f"line {i}: duplicate rollNumber {roll} (also line {seen[roll]})")
            continue
        seen[roll] = i

        dept_code, prog_code = cell(row, "departmentcode").upper(), cell(row, "programcode").upper()
        dept_id = DEPT_ID_BY_CODE.get(dept_code)
        program = PROG_BY_CODE.get(prog_code)
        if dept_id is None:
            errors.append(f"line {i}: unknown departmentCode {dept_code!r}")
            continue
        if program is None:
            errors.append(f"line {i}: unknown programCode {prog_code!r}")
            continue
        prog_id, prog_dept = program
        if prog_dept != dept_id:
            errors.append(
                f"line {i}: program {prog_code} belongs to {prog_dept}, "
                f"not {dept_code}"
            )
            continue

        try:
            semester = int(cell(row, "currentsemester"))
        except ValueError:
            errors.append(f"line {i}: currentSemester must be a number")
            continue
        if not 1 <= semester <= 12:
            errors.append(f"line {i}: currentSemester {semester} outside 1-12")
            continue

        year_raw = cell(row, "admissionyear")
        year = None
        if year_raw:
            try:
                year = int(year_raw)
            except ValueError:
                errors.append(f"line {i}: admissionYear must be a number")
                continue

        gender_raw = cell(row, "gender").lower()
        gender = None
        if gender_raw:
            try:
                gender = GenderEnum(gender_raw)
            except ValueError:
                errors.append(f"line {i}: gender must be male/female/other")
                continue

        dob_raw = cell(row, "dateofbirth")
        dob = None
        if dob_raw:
            try:
                dob = date.fromisoformat(dob_raw)
            except ValueError:
                errors.append(f"line {i}: dateOfBirth must be YYYY-MM-DD")
                continue

        active_raw = cell(row, "isactive").lower()
        if active_raw in ("", "true", "1", "yes"):
            is_active = True
        elif active_raw in ("false", "0", "no"):
            is_active = False
        else:
            errors.append(f"line {i}: isActive must be true/false")
            continue

        students.append(dict(
            # Deterministic, matching every other id in this file. Keyed on the
            # roll number (already unique) so the same student has the same id
            # in every environment; a positional stu-0001 scheme would silently
            # renumber everyone the next time a spreadsheet row is inserted.
            id=f"stu-{roll}",
            roll_number=roll,
            name=name,
            department_id=dept_id,
            program_id=prog_id,
            current_semester=semester,
            admission_year=year,
            gender=gender,
            date_of_birth=dob,
            email=_blank_to_none(cell(row, "email")),
            phone=_blank_to_none(cell(row, "phone")),
            address=_blank_to_none(cell(row, "address")),
            guardian_name=_blank_to_none(cell(row, "guardianname")),
            guardian_relation=_blank_to_none(cell(row, "guardianrelation")),
            guardian_phone=_blank_to_none(cell(row, "guardianphone")),
            is_active=is_active,
            graduated=False,
        ))

    if errors:
        raise RuntimeError(
            f"{STUDENTS_FILE} has {len(errors)} bad row(s):\n  "
            + "\n  ".join(errors)
        )
    return students


async def run() -> None:
    credentials: list[dict[str, str]] = []

    # Parsed before the session opens: a malformed roster then fails with no
    # transaction in flight and nothing half-written.
    students = load_students()

    async with async_session() as db:
        # -- Guard: never touch a database that already has real data. -----
        # `Student` is in the list because this script now writes to it: the
        # guard should cover every table it touches, so a re-run fails with
        # this clear message rather than 583 primary-key collisions.
        for model, label in ((Department, "departments"), (Teacher, "teachers"),
                             (Program, "programs"), (Student, "students")):
            n = await db.scalar(select(func.count()).select_from(model))
            if n:
                raise RuntimeError(
                    f"Refusing to seed: {n} {label} already exist. This script "
                    "only initialises an empty database (run reset_db.py first "
                    "in dev if you mean to start over)."
                )

        # -- Departments ---------------------------------------------------
        db.add_all([Department(id=i, name=n, code=c) for i, n, c in DEPARTMENTS])
        await db.flush()

        # -- Programs + semesters -------------------------------------------
        for key, name, code, level, dept_id, sem_count in PROGRAMS:
            pid = f"prog-{key}"
            db.add(Program(id=pid, name=name, code=code,
                           level=LEVEL[level], department_id=dept_id))
            for n in range(1, sem_count + 1):
                db.add(Semester(id=f"sem-{key}-{n}", program_id=pid, number=n))
        await db.flush()

        # -- Students (the real roster, if students.csv is present) -----------
        # Placed here because a Student needs only its department and program
        # rows to exist, both of which are now flushed. No login accounts:
        # students reach the app through their class-rep account.
        for student in students:
            db.add(Student(**student))
        await db.flush()

        # -- Teachers + their login accounts --------------------------------
        for i, (name, email, dept_id, qual, is_hod) in enumerate(TEACHERS, start=1):
            tid = f"tch-{i:03d}"
            db.add(Teacher(
                id=tid,
                employee_id=f"SCAS-T-{i:03d}",
                name=name,
                email=email,
                # NULL, not "": the staff list carried no phone numbers, and
                # "none on file" is what the column now means. Editable later
                # in the app.
                phone=None,
                department_id=dept_id,
                designation=DesignationEnum.ASSISTANT_PROFESSOR,
                qualification=qual,
                joining_date=date.fromisoformat(PLACEHOLDER_JOINING),
                is_hod=is_hod,
            ))
            pw = make_password()
            role = UserRoleEnum.HOD if is_hod else UserRoleEnum.TEACHER
            db.add(User(
                id=f"usr-{tid}", name=name, email=email,
                password_hash=hash_password(pw), role=role, teacher_id=tid,
            ))
            dept_name = next(n for d, n, _ in DEPARTMENTS if d == dept_id)
            credentials.append(dict(
                role=role.value, name=name, department=dept_name,
                program="", semester="", email=email, password=pw,
            ))
        await db.flush()

        # -- Class-rep accounts for every class running this odd term -------
        for key, name, code, level, dept_id, sem_count in PROGRAMS:
            dept_name = next(n for d, n, _ in DEPARTMENTS if d == dept_id)
            for sem in rep_semesters(level, sem_count):
                pw = make_password()
                email = f"rep.{key}.sem{sem}@scascollege.ac.in"
                db.add(User(
                    id=f"usr-rep-{key}-s{sem}",
                    name=f"{name} — Semester {sem} (Class Rep)",
                    email=email,
                    password_hash=hash_password(pw),
                    role=UserRoleEnum.STUDENT_REP,
                    program_id=f"prog-{key}",
                    class_semester=sem,
                ))
                credentials.append(dict(
                    role="student-rep", name=f"{name} — Sem {sem}",
                    department=dept_name, program=name, semester=str(sem),
                    email=email, password=pw,
                ))
        await db.flush()

        # -- Term 2026-2027 (Odd), set current -------------------------------
        db.add(AcademicTerm(id=TERM_ID, name=TERM_NAME, start_year=2026,
                            end_year=2027, parity=TermParityEnum.ODD))
        await db.flush()
        settings_row = await db.get(AppSettings, SETTINGS_ID)
        if settings_row is None:
            settings_row = AppSettings(id=SETTINGS_ID)
            db.add(settings_row)
        settings_row.current_term_id = TERM_ID

        # -- Principal, only when the database has none -----------------------
        # No teacher_id: the principal is linked to a Teacher record only if
        # they also take classes, which the office confirms case by case — the
        # admin adds the link in /users afterwards.
        has_principal = await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == UserRoleEnum.PRINCIPAL)
        )
        if not has_principal:
            pw = os.getenv("PRINCIPAL_PASSWORD") or make_password()
            db.add(User(
                id="usr-principal", name=PRINCIPAL_NAME, email=PRINCIPAL_EMAIL,
                password_hash=hash_password(pw), role=UserRoleEnum.PRINCIPAL,
            ))
            credentials.append(dict(
                role="principal", name=PRINCIPAL_NAME, department="", program="",
                semester="", email=PRINCIPAL_EMAIL, password=pw,
            ))

        # -- Admin, only when the database has none --------------------------
        has_admin = await db.scalar(
            select(func.count()).select_from(User).where(User.role == UserRoleEnum.ADMIN)
        )
        if not has_admin:
            pw = os.getenv("ADMIN_PASSWORD") or make_password()
            db.add(User(
                id="usr-admin", name="Administrator", email=ADMIN_EMAIL,
                password_hash=hash_password(pw), role=UserRoleEnum.ADMIN,
            ))
            credentials.append(dict(
                role="admin", name="Administrator", department="", program="",
                semester="", email=ADMIN_EMAIL, password=pw,
            ))

        await db.commit()

    await engine.dispose()

    with open(CREDENTIALS_FILE, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=[
            "role", "name", "department", "program", "semester",
            "email", "password",
        ])
        w.writeheader()
        w.writerows(credentials)

    n_teachers = len(TEACHERS)
    n_hods = sum(1 for t in TEACHERS if t[4])
    n_reps = sum(1 for row in credentials if row["role"] == "student-rep")
    print(f"Seeded {len(DEPARTMENTS)} departments, {len(PROGRAMS)} programs, "
          f"{n_teachers} teachers ({n_hods} HODs), {n_reps} class-rep accounts, "
          f"{len(students)} students.")
    print(f"Current term: {TERM_NAME}")
    print(f"Credentials written to {CREDENTIALS_FILE} — distribute, then delete it.")


if __name__ == "__main__":
    asyncio.run(run())
