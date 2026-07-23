"""Cascade vs. orphan invariants (`CLAUDE.md`): deleting a Department wipes
out its curriculum branch (Program -> Semester -> Course -> CourseAssignment
-> AttendanceSession -> AttendanceRecord -> StudyMaterial, all `ON DELETE
CASCADE`), while Teacher/Student rows that merely *belong* to it are orphaned
(`department_id`/`program_id` FK `SET NULL`), never deleted. Deleting a
Teacher/Student directly has its own, different mix of cascade vs. orphan on
the rows that reference *them* (see models/*.py's `ondelete=`)."""

from __future__ import annotations


async def _build_full_chain(
    dept_factory, program_factory, semesters_of, course_factory,
    teacher_factory, term_factory, assignment_factory, client, admin_headers,
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    semesters = await semesters_of(program["id"])
    semester = semesters[0]
    course = await course_factory(semester_id=semester["id"])
    teacher = await teacher_factory(department_id=dept["id"])
    term = await term_factory()
    assignment = await assignment_factory(
        course_id=course["id"], teacher_id=teacher["id"], term_id=term["id"]
    )

    # A material for the course.
    mat_r = await client.post(
        "/materials",
        json={
            "courseId": course["id"],
            "termId": term["id"],
            "title": "Lecture notes",
            "url": "https://example.com/notes.pdf",
        },
        headers=admin_headers,
    )
    assert mat_r.status_code == 201, mat_r.text
    material = mat_r.json()

    return {
        "dept": dept,
        "program": program,
        "semester": semester,
        "course": course,
        "teacher": teacher,
        "term": term,
        "assignment": assignment,
        "material": material,
    }


async def test_delete_department_cascades_whole_curriculum(
    client,
    admin_headers,
    dept_factory,
    program_factory,
    semesters_of,
    course_factory,
    teacher_factory,
    term_factory,
    assignment_factory,
    student_factory,
):
    chain = await _build_full_chain(
        dept_factory, program_factory, semesters_of, course_factory,
        teacher_factory, term_factory, assignment_factory, client, admin_headers,
    )
    student = await student_factory(
        department_id=chain["dept"]["id"], program_id=chain["program"]["id"]
    )

    # Mark attendance so an AttendanceSession + AttendanceRecord exist too.
    att_r = await client.post(
        "/attendance",
        json={
            "courseId": chain["course"]["id"],
            "date": "2024-01-10",
            "period": 1,
            "termId": chain["term"]["id"],
            "records": [{"studentId": student["id"], "status": "present"}],
        },
        headers=admin_headers,
    )
    assert att_r.status_code == 200, att_r.text
    session_id = att_r.json()["id"]

    # Delete the department.
    del_r = await client.delete(f"/departments/{chain['dept']['id']}", headers=admin_headers)
    assert del_r.status_code == 204

    # Program, semester, course all gone.
    assert (await client.get(f"/programs/{chain['program']['id']}", headers=admin_headers)).status_code == 404
    courses = await client.get(
        "/semesters", params={"programId": chain["program"]["id"]}, headers=admin_headers
    )
    # The program itself is gone, so listing its semesters is empty (not 404 —
    # /semesters just filters by programId).
    assert courses.json() == []

    all_courses = await client.get("/courses", headers=admin_headers)
    assert all(c["id"] != chain["course"]["id"] for c in all_courses.json())

    # CourseAssignment gone.
    assignments = await client.get(
        "/assignments", params={"termId": chain["term"]["id"]}, headers=admin_headers
    )
    assert assignments.json() == []

    # AttendanceSession + its records gone.
    sessions = await client.get(
        "/attendance",
        params={"courseId": chain["course"]["id"], "termId": chain["term"]["id"]},
        headers=admin_headers,
    )
    assert sessions.json()["items"] == []

    # StudyMaterial gone.
    materials = await client.get(
        "/materials", params={"courseId": chain["course"]["id"]}, headers=admin_headers
    )
    assert materials.json()["items"] == []

    # Teacher survives, orphaned (departmentId null), not deleted.
    teacher_r = await client.get(f"/teachers/{chain['teacher']['id']}", headers=admin_headers)
    assert teacher_r.status_code == 200
    assert teacher_r.json()["departmentId"] is None

    # Student survives, orphaned (departmentId + programId null).
    student_r = await client.get(f"/students/{student['id']}", headers=admin_headers)
    assert student_r.status_code == 200
    assert student_r.json()["departmentId"] is None
    assert student_r.json()["programId"] is None


async def test_delete_teacher_cascades_assignments_but_orphans_user_account(
    client,
    admin_headers,
    dept_factory,
    program_factory,
    semesters_of,
    course_factory,
    teacher_factory,
    term_factory,
    assignment_factory,
    user_factory,
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    semesters = await semesters_of(program["id"])
    course = await course_factory(semester_id=semesters[0]["id"])
    teacher = await teacher_factory(department_id=dept["id"])
    term = await term_factory()
    await assignment_factory(course_id=course["id"], teacher_id=teacher["id"], term_id=term["id"])

    login_account = await user_factory(role="teacher", teacher_id=teacher["id"])

    del_r = await client.delete(f"/teachers/{teacher['id']}", headers=admin_headers)
    assert del_r.status_code == 204

    # Assignment cascaded away (CourseAssignment.teacher_id ondelete=CASCADE).
    assignments = await client.get(
        "/assignments", params={"termId": term["id"]}, headers=admin_headers
    )
    assert assignments.json() == []

    # The login account itself is NOT deleted — only unlinked (SET NULL).
    users_r = await client.get("/users?pageSize=200", headers=admin_headers)
    assert users_r.status_code == 200
    matching = [
        u for u in users_r.json()["items"] if u["id"] == login_account["id"]
    ]
    assert len(matching) == 1
    assert matching[0]["teacherId"] is None


async def test_delete_student_cascades_own_records_but_session_survives(
    client,
    admin_headers,
    dept_factory,
    program_factory,
    semesters_of,
    course_factory,
    term_factory,
    student_factory,
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    semesters = await semesters_of(program["id"])
    course = await course_factory(semester_id=semesters[0]["id"])
    term = await term_factory()

    student_a = await student_factory(department_id=dept["id"], program_id=program["id"])
    student_b = await student_factory(department_id=dept["id"], program_id=program["id"])

    att_r = await client.post(
        "/attendance",
        json={
            "courseId": course["id"],
            "date": "2024-02-01",
            "period": 1,
            "termId": term["id"],
            "records": [
                {"studentId": student_a["id"], "status": "present"},
                {"studentId": student_b["id"], "status": "absent"},
            ],
        },
        headers=admin_headers,
    )
    assert att_r.status_code == 200, att_r.text
    session_id = att_r.json()["id"]

    del_r = await client.delete(f"/students/{student_a['id']}", headers=admin_headers)
    assert del_r.status_code == 204

    sessions = await client.get(
        "/attendance",
        params={"courseId": course["id"], "termId": term["id"]},
        headers=admin_headers,
    )
    items = sessions.json()["items"]
    assert len(items) == 1  # the session itself survives
    remaining_student_ids = {rec["studentId"] for rec in items[0]["records"]}
    assert student_a["id"] not in remaining_student_ids
    assert student_b["id"] in remaining_student_ids
