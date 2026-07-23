"""Uniqueness constraints. Roll number / employee id / student-rep-per-class
surface as 409 Conflict (`services/util.py::conflict`, either from a DB
`IntegrityError` catch or an explicit pre-check).

The CourseAssignment `(courseId, teacherId, termId)` triple is *not* a 409 in
the current implementation — `services/assignments.py::assign_teacher`
checks for an existing row first and returns it unchanged (idempotent no-op)
rather than raising. The database-level `uq_assignment_triple` constraint
exists as a backstop, but the service layer never gives it a chance to fire
on a sequential double-call through the API. That's the behavior asserted
below.
"""

from __future__ import annotations


async def test_duplicate_roll_number_is_409(client, admin_headers, dept_factory, program_factory, student_factory):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    first = await student_factory(department_id=dept["id"], program_id=program["id"], roll_number="ROLL-DUP")

    payload = {
        "rollNumber": "ROLL-DUP",
        "name": "Someone Else",
        "email": "someone-else@example.com",
        "phone": "8000000001",
        "address": "456 Test Street",
        "dateOfBirth": "2002-01-01",
        "gender": "female",
        "departmentId": dept["id"],
        "programId": program["id"],
        "currentSemester": 1,
        "admissionYear": 2021,
        "guardianName": "Parent",
        "guardianRelation": "Mother",
        "guardianPhone": "7000000001",
    }
    r = await client.post("/students", json=payload, headers=admin_headers)
    assert r.status_code == 409
    assert first["rollNumber"] == "ROLL-DUP"


async def test_duplicate_employee_id_is_409(client, admin_headers, dept_factory, teacher_factory):
    dept = await dept_factory()
    await teacher_factory(department_id=dept["id"], employee_id="EMP-DUP")

    payload = {
        "employeeId": "EMP-DUP",
        "name": "Another Teacher",
        "email": "another-teacher@example.com",
        "phone": "9000000001",
        "departmentId": dept["id"],
        "designation": "Lecturer",
        "qualification": "MSc",
        "joiningDate": "2021-01-01",
        "isHod": False,
    }
    r = await client.post("/teachers", json=payload, headers=admin_headers)
    assert r.status_code == 409


async def test_duplicate_user_email_is_409(client, admin_headers, user_factory):
    first = await user_factory(role="principal", email="dup-user@example.com")
    r = await client.post(
        "/users",
        json={
            "name": "Someone",
            "email": "dup-user@example.com",
            "role": "principal",
            "password": "pass1234",
        },
        headers=admin_headers,
    )
    assert r.status_code == 409
    assert first["email"] == "dup-user@example.com"


async def test_second_student_rep_for_same_class_is_409(
    client, admin_headers, dept_factory, program_factory, user_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)

    await user_factory(role="student-rep", program_id=program["id"], class_semester=1)

    r = await client.post(
        "/users",
        json={
            "name": "Second Rep",
            "email": "second-rep@example.com",
            "role": "student-rep",
            "password": "pass1234",
            "programId": program["id"],
            "classSemester": 1,
        },
        headers=admin_headers,
    )
    assert r.status_code == 409


async def test_student_rep_uniqueness_is_scoped_per_class(
    client, admin_headers, dept_factory, program_factory, user_factory
):
    """A different semester in the same program may have its own rep — the
    uniqueness key is (programId, classSemester), not programId alone."""
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=2)

    rep_1 = await user_factory(role="student-rep", program_id=program["id"], class_semester=1)
    rep_2 = await user_factory(role="student-rep", program_id=program["id"], class_semester=2)
    assert rep_1["id"] != rep_2["id"]


async def test_assignment_triple_is_idempotent_not_a_duplicate(
    client,
    admin_headers,
    dept_factory,
    program_factory,
    semesters_of,
    course_factory,
    teacher_factory,
    term_factory,
    assignment_factory,
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    semesters = await semesters_of(program["id"])
    course = await course_factory(semester_id=semesters[0]["id"])
    teacher = await teacher_factory(department_id=dept["id"])
    term = await term_factory()

    first = await assignment_factory(course_id=course["id"], teacher_id=teacher["id"], term_id=term["id"])
    second = await assignment_factory(course_id=course["id"], teacher_id=teacher["id"], term_id=term["id"])

    # Same row back, not a 409 and not a second row.
    assert first["id"] == second["id"]

    all_assignments = await client.get(
        "/assignments", params={"termId": term["id"]}, headers=admin_headers
    )
    matching = [
        a
        for a in all_assignments.json()
        if a["courseId"] == course["id"] and a["teacherId"] == teacher["id"]
    ]
    assert len(matching) == 1
