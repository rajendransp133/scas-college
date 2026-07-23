"""The dashboard's "corrections this week" counts edits *made* this week.

`AuditEntry` carries two dates and they mean different things: `at` is when the
edit happened, `date` is which day's register it touched. The card filtered on
`date`, so it reported "corrections to sessions held in the last 7 days" — and
therefore showed nothing at all for the case an oversight card exists to
surface: someone reaching back today to rewrite a register from months ago.

The distinction only shows up when the two dates disagree, which is exactly the
suspicious case and exactly what a test built around "mark today, correct today"
would miss.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest_asyncio

# Comfortably outside the 7-day window, and in the past so the lock/roster
# rules that care about future dates don't interfere.
OLD_SESSION_DATE = (date.today() - timedelta(days=90)).isoformat()
RECENT_SESSION_DATE = (date.today() - timedelta(days=1)).isoformat()


@pytest_asyncio.fixture
async def klass(
    dept_factory, program_factory, semesters_of, course_factory, student_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    semesters = await semesters_of(program["id"])
    course = await course_factory(semester_id=semesters[0]["id"])
    student = await student_factory(department_id=dept["id"], program_id=program["id"])
    return {"course": course, "student": student}


async def _save(client, headers, course_id, term_id, student_id, status_, when):
    return await client.post(
        "/attendance",
        json={
            "courseId": course_id,
            "date": when,
            "period": 1,
            "termId": term_id,
            "records": [{"studentId": student_id, "status": status_}],
        },
        headers=headers,
    )


async def _corrections(client, headers):
    r = await client.get("/stats/dashboard", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["correctionsThisWeek"]


async def test_a_correction_to_an_old_session_counts_as_this_weeks(
    client, admin_headers, term_factory, klass
):
    """The regression. Filtering on the attendance date scored this 0."""
    term = await term_factory()
    course, student = klass["course"], klass["student"]

    before = await _corrections(client, admin_headers)
    await _save(
        client, admin_headers, course["id"], term["id"], student["id"],
        "absent", OLD_SESSION_DATE,
    )
    await _save(
        client, admin_headers, course["id"], term["id"], student["id"],
        "present", OLD_SESSION_DATE,
    )
    assert await _corrections(client, admin_headers) == before + 1


async def test_a_correction_to_a_recent_session_still_counts(
    client, admin_headers, term_factory, klass
):
    """The case that always worked has to keep working — the fix changes which
    column is read, not which edits qualify."""
    term = await term_factory()
    course, student = klass["course"], klass["student"]

    before = await _corrections(client, admin_headers)
    await _save(
        client, admin_headers, course["id"], term["id"], student["id"],
        "absent", RECENT_SESSION_DATE,
    )
    await _save(
        client, admin_headers, course["id"], term["id"], student["id"],
        "present", RECENT_SESSION_DATE,
    )
    assert await _corrections(client, admin_headers) == before + 1


async def test_marking_without_correcting_does_not_count(
    client, admin_headers, term_factory, klass
):
    """Only EDIT entries; an original mark is not a correction however old the
    session is."""
    term = await term_factory()
    course, student = klass["course"], klass["student"]

    before = await _corrections(client, admin_headers)
    await _save(
        client, admin_headers, course["id"], term["id"], student["id"],
        "absent", OLD_SESSION_DATE,
    )
    assert await _corrections(client, admin_headers) == before
