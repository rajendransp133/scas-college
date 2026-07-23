"""At most one HOD per department (`services/teachers.py::_demote_other_hods`,
backed by the partial unique index `uq_one_hod_per_department`)."""

from __future__ import annotations


async def test_creating_a_second_hod_demotes_the_first(
    client, admin_headers, dept_factory, teacher_factory
):
    dept = await dept_factory()
    teacher_1 = await teacher_factory(department_id=dept["id"], is_hod=True)
    assert teacher_1["isHod"] is True

    teacher_2 = await teacher_factory(department_id=dept["id"], is_hod=True)
    assert teacher_2["isHod"] is True

    refreshed_1 = await client.get(f"/teachers/{teacher_1['id']}", headers=admin_headers)
    assert refreshed_1.json()["isHod"] is False


async def test_update_teacher_is_hod_demotes_previous_hod(
    client, admin_headers, dept_factory, teacher_factory
):
    dept = await dept_factory()
    teacher_1 = await teacher_factory(department_id=dept["id"], is_hod=True)
    teacher_2 = await teacher_factory(department_id=dept["id"], is_hod=False)

    r = await client.put(
        f"/teachers/{teacher_2['id']}", json={"isHod": True}, headers=admin_headers
    )
    assert r.status_code == 200
    assert r.json()["isHod"] is True

    refreshed_1 = await client.get(f"/teachers/{teacher_1['id']}", headers=admin_headers)
    assert refreshed_1.json()["isHod"] is False


async def test_set_hod_endpoint_demotes_previous_hod(
    client, admin_headers, dept_factory, teacher_factory
):
    dept = await dept_factory()
    teacher_1 = await teacher_factory(department_id=dept["id"], is_hod=True)
    teacher_2 = await teacher_factory(department_id=dept["id"])

    r = await client.post(
        f"/teachers/{teacher_2['id']}/hod", json={"isHod": True}, headers=admin_headers
    )
    assert r.status_code == 200
    assert r.json()["isHod"] is True

    refreshed_1 = await client.get(f"/teachers/{teacher_1['id']}", headers=admin_headers)
    assert refreshed_1.json()["isHod"] is False

    hods = await client.get("/teachers/hods", headers=admin_headers)
    hod_ids = {t["id"] for t in hods.json()}
    assert hod_ids == {teacher_2["id"]}


async def test_hod_is_scoped_per_department(
    client, admin_headers, dept_factory, teacher_factory
):
    """Two different departments may each have their own HOD at the same time
    — the uniqueness is per-department, not global."""
    dept_a = await dept_factory()
    dept_b = await dept_factory()
    hod_a = await teacher_factory(department_id=dept_a["id"], is_hod=True)
    hod_b = await teacher_factory(department_id=dept_b["id"], is_hod=True)

    refreshed_a = await client.get(f"/teachers/{hod_a['id']}", headers=admin_headers)
    refreshed_b = await client.get(f"/teachers/{hod_b['id']}", headers=admin_headers)
    assert refreshed_a.json()["isHod"] is True
    assert refreshed_b.json()["isHod"] is True
