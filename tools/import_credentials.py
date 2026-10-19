"""Set each account's password from a seed_credentials.csv.

For when the database was seeded but the credentials file was lost (or you
want the accounts to match a file you already distributed). Only touches
`password_hash` (and bumps `token_epoch`, so any live session is signed out)
for rows whose email already exists — it never creates or deletes users.

Run inside the API image, with the project directory mounted at /out:

    docker compose -f docker-compose.local.yml run --rm --no-deps \
        -e PYTHONPATH=/app bootstrap python /out/tools/import_credentials.py /out/seed_credentials.csv
"""
import asyncio
import csv
import sys

from sqlalchemy import func, update

from database.connection import async_session, engine
from models.User import User
from security import hash_password


async def run(path: str) -> None:
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    updated, missing = 0, []
    async with async_session() as db:
        for row in rows:
            email, password = row["email"].strip(), row["password"]
            if not email or not password:
                continue
            res = await db.execute(
                update(User)
                .where(func.lower(User.email) == email.lower())
                .values(
                    password_hash=hash_password(password),
                    token_epoch=User.token_epoch + 1,
                )
            )
            if res.rowcount:
                updated += res.rowcount
            else:
                missing.append(email)
        await db.commit()
    await engine.dispose()

    print(f"Updated {updated} of {len(rows)} accounts from {path}.")
    if missing:
        print(f"{len(missing)} emails in the file have no account:")
        for e in missing:
            print(f"  {e}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: import_credentials.py <seed_credentials.csv>")
    asyncio.run(run(sys.argv[1]))
