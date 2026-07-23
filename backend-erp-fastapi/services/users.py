from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from enums.UserRole import UserRoleEnum
from ids import new_id
import services.cache as cache_keys
from models import User
from schemas.User import UserCreate, UserUpdate
from services.cache import cached, invalidate
from security import hash_password
from services.pagination import PageParams, apply_sort, paginate, search_clause
from services.util import conflict, not_found

SORTABLE = {
    "name": User.name,
    "email": User.email,
    "role": User.role,
}


async def list_users(
    db: AsyncSession,
    params: PageParams,
    search: Optional[str] = None,
    role: Optional[UserRoleEnum] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
) -> tuple[list[User], int]:
    # No trigram index here (unlike students/teachers): the account table is
    # bounded by staff + one rep per class — hundreds, not thousands — so the
    # substring scan is cheap. Add one if that stops being true.
    stmt = select(User)
    if role is not None:
        stmt = stmt.where(User.role == role)
    if search and search.strip():
        stmt = stmt.where(or_(*search_clause(search, User.name, User.email)))
    stmt = apply_sort(stmt, sort_by, sort_dir, SORTABLE, User.name)
    items, total = await paginate(db, stmt, params)
    return list(items), total


async def list_directory(db: AsyncSession) -> list[dict]:
    """id → name for every account (no sensitive fields).

    Every marked-by / editor / audit-actor name resolves through this, so it is
    fetched by most pages; it changes only when accounts do.
    """

    async def load() -> list[dict]:
        rows = await db.execute(select(User.id, User.name).order_by(User.name))
        return [{"id": r[0], "name": r[1]} for r in rows.all()]

    return await cached(f"{cache_keys.DIRECTORY}:all", load)


async def get_user(db: AsyncSession, user_id: str) -> User:
    u = await db.get(User, user_id)
    if u is None:
        raise not_found("User not found")
    return u


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    rows = await db.execute(
        select(User).where(func.lower(User.email) == email.strip().lower())
    )
    return rows.scalar_one_or_none()


async def _assert_email_free(
    db: AsyncSession, email: str, exclude_id: Optional[str] = None
) -> None:
    existing = await get_user_by_email(db, email)
    if existing is not None and existing.id != exclude_id:
        raise conflict("A user with this email already exists")


async def _assert_rep_class_free(
    db: AsyncSession,
    program_id: Optional[str],
    class_semester: Optional[int],
    exclude_id: Optional[str] = None,
) -> None:
    if program_id is None or class_semester is None:
        return
    rows = await db.execute(
        select(User).where(
            User.role == UserRoleEnum.STUDENT_REP,
            User.program_id == program_id,
            User.class_semester == class_semester,
        )
    )
    existing = rows.scalar_one_or_none()
    if existing is not None and existing.id != exclude_id:
        raise conflict("A representative account for this class already exists")


def assert_not_self_demotion(actor: User, user_id: str, new_role: UserRoleEnum) -> None:
    """Nobody changes their own role.

    `delete_user` already refuses self-deletion; without the same guard here,
    one `PUT /users/<own id> {"role": "teacher"}` strips the actor's own
    capabilities mid-request. For the last remaining admin that is unrecoverable
    from inside the app: `assert_may_manage` (correctly) stops a principal from
    minting an admin, so once the final admin demotes itself no account left in
    the system can create one, and the fix is a hand-written UPDATE against the
    database.

    Handing over the role is still possible — the *other* admin performs the
    demotion, which keeps at least one admin at every point.
    """
    if user_id == actor.id and new_role != actor.role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "You cannot change your own role. Ask another administrator "
                "to do it."
            ),
        )


def assert_may_manage(actor: User, target_role: UserRoleEnum) -> None:
    """Guard the one privilege-escalation path opened by giving principals
    `manage_users`.

    The capability matrix deliberately withholds correction/oversight
    (`edit_attendance`, `override_lock`, `view_audit`, `lock_attendance`) from
    the principal. Unrestricted account management would hand it straight back:
    mint an admin account, log in as it. So only an admin may touch an admin
    account — create one, edit one, promote anyone into the role, or delete one.
    """
    if target_role == UserRoleEnum.ADMIN and actor.role != UserRoleEnum.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an administrator can manage administrator accounts",
        )


async def create_user(db: AsyncSession, data: UserCreate, actor: User) -> User:
    assert_may_manage(actor, data.role)
    await _assert_email_free(db, data.email)
    if data.role == UserRoleEnum.STUDENT_REP:
        await _assert_rep_class_free(db, data.program_id, data.class_semester)
    user = User(
        id=new_id("usr"),
        name=data.name,
        email=data.email,
        password_hash=await run_in_threadpool(hash_password, data.password),
        role=data.role,
        teacher_id=data.teacher_id,
        program_id=data.program_id,
        class_semester=data.class_semester,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    invalidate(cache_keys.DIRECTORY)
    return user


async def update_user(
    db: AsyncSession, user_id: str, data: UserUpdate, actor: User
) -> User:
    user = await get_user(db, user_id)
    fields = data.model_dump(exclude_unset=True, by_alias=False)

    if "email" in fields and fields["email"]:
        await _assert_email_free(db, fields["email"], exclude_id=user_id)

    new_role = fields.get("role", user.role)
    # Both sides of the edit: neither demoting an existing admin nor promoting
    # someone into the role is available to a non-admin.
    assert_may_manage(actor, user.role)
    assert_may_manage(actor, new_role)
    assert_not_self_demotion(actor, user_id, new_role)
    new_program = fields.get("program_id", user.program_id)
    new_semester = fields.get("class_semester", user.class_semester)
    if new_role == UserRoleEnum.STUDENT_REP:
        await _assert_rep_class_free(
            db, new_program, new_semester, exclude_id=user_id
        )

    for key, value in fields.items():
        if key == "password":
            if value:
                user.password_hash = await run_in_threadpool(hash_password, value)
            continue
        setattr(user, key, value)

    await db.commit()
    await db.refresh(user)
    invalidate(cache_keys.DIRECTORY)
    return user


async def delete_user(db: AsyncSession, user_id: str, actor: User) -> None:
    if user_id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )
    user = await get_user(db, user_id)
    assert_may_manage(actor, user.role)
    await db.delete(user)
    await db.commit()
    invalidate(cache_keys.DIRECTORY)
