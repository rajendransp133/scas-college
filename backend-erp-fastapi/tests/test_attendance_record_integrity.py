"""Every mutation of a saved session leaves a trace.

The correction path (`original_status` + an EDIT entry) was always audited, but
three neighbouring mutations on the same code path were not, and each is a way
to change what a register says with nothing in the log:

* **removing a student from the payload** deleted their record outright — the
  status, the `original_status` provenance and the row itself. This is strictly
  more effective than a correction at hiding an absence, because
  `correction_red_flags` only inspects rows that still exist.
* **adding a student to a saved session** wrote an unstamped record,
  indistinguishable from an original mark.
* **changing `termId` on a re-save** moved the whole session out of the term
  whose summary reports it.

These tests pin all three. They are regression tests in the strict sense: each
one passed silently before the fix, because "no audit entry" is not an error.
"""

from __future__ import annotations

import pytest_asyncio


@pytest_asyncio.fixture
async def klass(
    dept_factory, program_factory, semesters_of, course_factory, student_factory
):
    dept = await dept_factory()
    program = await program_factory(department_id=dept["id"], semester_count=1)
    semesters = await semesters_of(program["id"])
    course = await course_factory(semester_id=semesters[0]["id"])
    a = await student_factory(department_id=dept["id"], program_id=program["id"])
    b = await student_factory(department_id=dept["id"], program_id=program["id"])
    return {"course": course, "a": a, "b": b}


async def _save(client, headers, course_id, term_id, records, date="2024-03-01"):
    return await client.post(
        "/attendance",
        json={
            "courseId": course_id,
            "date": date,
            "period": 1,
            "termId": term_id,
            "records": records,
        },
        headers=headers,
    )


async def _audit(client, headers, **params):
    r = await client.get("/audit", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Removing a student's record
# ---------------------------------------------------------------------------


async def test_dropping_a_student_from_a_re_save_is_audited(
    client, admin_headers, term_factory, klass
):
    term = await term_factory()
    a, b = klass["a"], klass["b"]

    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [
            {"studentId": a["id"], "status": "absent"},
            {"studentId": b["id"], "status": "present"},
        ],
    )
    # Re-save without student A: their absence disappears from the register.
    r = await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [{"studentId": b["id"], "status": "present"}],
    )
    assert r.status_code == 200, r.text
    assert [rec["studentId"] for rec in r.json()["records"]] == [b["id"]]

    log = await _audit(client, admin_headers, studentId=a["id"])
    entries = [e for e in log["items"] if e["action"] == "remove-record"]
    assert len(entries) == 1, log
    entry = entries[0]
    # The status they were carrying when removed is the whole point of the entry.
    assert entry["from"] == "absent"
    assert entry["to"] is None
    assert entry["courseId"] == klass["course"]["id"]
    assert entry["date"] == "2024-03-01"
    assert entry["period"] == 1


async def test_removal_records_the_status_as_originally_marked(
    client, admin_headers, term_factory, klass
):
    """A correction followed by a removal must not launder the original mark.

    Absent → corrected to present → removed. The removal entry reports
    `absent`: the corrected value is what someone wanting the absence gone
    would rather have on record.
    """
    term = await term_factory()
    a, b = klass["a"], klass["b"]
    both = [
        {"studentId": a["id"], "status": "absent"},
        {"studentId": b["id"], "status": "present"},
    ]
    await _save(client, admin_headers, klass["course"]["id"], term["id"], both)
    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [
            {"studentId": a["id"], "status": "present"},  # correction
            {"studentId": b["id"], "status": "present"},
        ],
    )
    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [{"studentId": b["id"], "status": "present"}],  # removal
    )

    log = await _audit(client, admin_headers, studentId=a["id"])
    removal = next(e for e in log["items"] if e["action"] == "remove-record")
    assert removal["from"] == "absent"


async def test_a_removal_does_not_erase_the_earlier_correction_entry(
    client, admin_headers, term_factory, klass
):
    """The log is append-only: the correction stays visible after the row it
    described is gone."""
    term = await term_factory()
    a, b = klass["a"], klass["b"]
    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [
            {"studentId": a["id"], "status": "absent"},
            {"studentId": b["id"], "status": "present"},
        ],
    )
    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [
            {"studentId": a["id"], "status": "present"},
            {"studentId": b["id"], "status": "present"},
        ],
    )
    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [{"studentId": b["id"], "status": "present"}],
    )

    log = await _audit(client, admin_headers, studentId=a["id"])
    actions = {e["action"] for e in log["items"]}
    assert {"edit", "remove-record"} <= actions, log


# ---------------------------------------------------------------------------
# Adding a student to a saved session
# ---------------------------------------------------------------------------


async def test_adding_a_student_to_a_saved_session_is_audited_and_stamped(
    client, admin_headers, term_factory, klass
):
    term = await term_factory()
    a, b = klass["a"], klass["b"]

    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [{"studentId": a["id"], "status": "present"}],
    )
    r = await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [
            {"studentId": a["id"], "status": "present"},
            {"studentId": b["id"], "status": "absent"},
        ],
    )
    assert r.status_code == 200, r.text

    added = next(rec for rec in r.json()["records"] if rec["studentId"] == b["id"])
    # Unstamped, this row would be indistinguishable from an original mark.
    assert added["editedBy"] is not None
    assert added["editedAt"] is not None

    log = await _audit(client, admin_headers, studentId=b["id"])
    entry = next(e for e in log["items"] if e["action"] == "edit")
    assert entry["from"] is None  # there was no prior record
    assert entry["to"] == "absent"


# ---------------------------------------------------------------------------
# Re-assigning the term
# ---------------------------------------------------------------------------


async def test_a_re_save_cannot_move_the_session_to_another_term(
    client, admin_headers, term_factory, klass
):
    """Silently accepting a different termId hid a session from the summary of
    the term that actually reports it — an erasure with nothing deleted."""
    term = await term_factory()
    other = await term_factory(parity="even")
    a = klass["a"]

    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [{"studentId": a["id"], "status": "absent"}],
    )
    r = await _save(
        client, admin_headers, klass["course"]["id"], other["id"],
        [{"studentId": a["id"], "status": "absent"}],
    )
    assert r.status_code == 409, r.text

    # And the session is still where it was.
    reg = await client.get(
        "/attendance/register",
        params={"courseId": klass["course"]["id"], "termId": term["id"]},
        headers=admin_headers,
    )
    assert len(reg.json()) == 1


async def test_a_re_save_in_the_same_term_still_works(
    client, admin_headers, term_factory, klass
):
    """The term guard must not break the ordinary correction path."""
    term = await term_factory()
    a = klass["a"]
    await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [{"studentId": a["id"], "status": "absent"}],
    )
    r = await _save(
        client, admin_headers, klass["course"]["id"], term["id"],
        [{"studentId": a["id"], "status": "present"}],
    )
    assert r.status_code == 200, r.text
    rec = r.json()["records"][0]
    assert rec["status"] == "present"
    assert rec["originalStatus"] == "absent"
