# Deploy runbook

Two Compose stacks, same images:

| File | Target | Entry point |
|---|---|---|
| `docker-compose.local.yml` | **Docker Desktop on your machine** — everything in containers, zero config | `http://localhost:8080` |
| `docker-compose.yml` | A single VPS with a real domain + Let's Encrypt TLS | `https://<DOMAIN>` |

Jump to [Run it all locally](#run-it-all-locally-docker-desktop) for the
first; the numbered sections below are the VPS deploy.

---

## Run it all locally (Docker Desktop)

Nothing needs to run on the host — no Python venv, no `npm run dev`, no local
Postgres. One command brings up Postgres, Redis, the API, the frontend and
Caddy, applies migrations, and seeds the real college data:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Then open **http://localhost:8080**.

- **No `.env` needed.** Every variable has a working default baked into the
  compose file (including a concrete `JWT_SECRET`, so the
  `ENVIRONMENT=production` startup guard passes). Create a root `.env` only
  if you want to override something — Compose picks it up automatically.
- **Logins** land in `./seed_credentials.csv` (gitignored) the first time the
  stack comes up — teachers, HODs, and one class-rep account per class, with
  randomly generated passwords. Set `ADMIN_PASSWORD` in a `.env` to choose the
  admin password instead of getting a random one.
- **`up` is repeatable.** The `bootstrap` service re-runs migrations every
  time (a no-op once current) and skips seeding when the database already has
  data, so restarting never duplicates or destroys anything.
- **Data persists** in the `postgres_data` named volume across `down` and
  rebuilds. To wipe it and start completely fresh:
  ```bash
  docker compose -f docker-compose.local.yml down -v
  rm seed_credentials.csv          # new passwords are generated next time
  docker compose -f docker-compose.local.yml up -d --build
  ```
- **Postgres is published on `localhost:5432`** so pgAdmin/DBeaver/psql can
  connect (user/db/password default to `scas` / `erp_scas` / `scas_local_pw`).
- **Changing the port** (`APP_PORT=9000` in `.env`) requires
  `docker compose -f docker-compose.local.yml build web` afterwards, not just
  a restart — `NEXT_PUBLIC_API_URL` is inlined into the client bundle at build
  time.

Useful commands:

```bash
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs -f api
docker compose -f docker-compose.local.yml down       # stop, keep data
```

---

## Live deploy: erp.scascollege.ac.in

The college VPS (139.84.210.114) runs the **`docker-compose.local.yml`** stack, not
`docker-compose.yml`: host nginx already owns 80/443 (it also serves
`id.scascollege.ac.in`), so Caddy can't bind them. Instead:

- `/etc/nginx/sites-available/erp` terminates TLS (certbot, auto-renewing) and
  proxies to `127.0.0.1:8080`, overwriting `X-Forwarded-For` with `$remote_addr`.
- `.env` sets `APP_PORT=127.0.0.1:8080` — Docker port publishing bypasses ufw, so
  without the loopback bind the stack is public over plain HTTP.
- `Caddyfile.local` trusts private-range proxies so the client IP survives to the
  login rate limiter.
- Backups: `docker compose -f docker-compose.local.yml run --rm backup` (same
  service as below), scheduled from root's crontab.

Updating: `git pull && docker compose -f docker-compose.local.yml up -d --build`
(the `bootstrap` service applies new migrations).

---

## VPS deploy

Docker Compose deploy for a single VPS. Services: `postgres`, `redis`,
`migrate` (one-shot), `seed` (one-shot), `api`, `web`, `caddy` — see
`docker-compose.yml`, `backend-erp-fastapi/Dockerfile`,
`frontend-erp-react/Dockerfile`, `Caddyfile`.

## 1. Configure

```bash
cp .env.example .env
# edit .env: POSTGRES_*, JWT_SECRET, CORS_ORIGINS, NEXT_PUBLIC_API_URL, DOMAIN
```

**`NEXT_PUBLIC_API_URL` must be correct *before* building `web`.** Next.js
inlines `NEXT_PUBLIC_*` variables into the client JS bundle at build time —
they are not read from the environment at container start. If this value is
wrong or changes later (new domain, switching path-based → subdomain
routing, etc.), the fix is `docker compose build web` again, not a restart
or an env var edit on the running container.

## 2. Build images

```bash
docker compose build
```

## 3. Apply migrations (explicit — not part of `up`)

```bash
docker compose run --rm migrate
```

`migrate` is a one-shot service (`restart: "no"`), deliberately kept out of
`api`'s startup command and out of the normal `up` flow. This is what keeps
scaling `api` to multiple replicas safe later — if every replica ran
`alembic upgrade head` on its own boot, they'd race the same migration
against the same database concurrently. Run it once, explicitly, before
`up`, and again after every deploy that ships a new migration.

## 4. Seed the real college (first deploy only)

```bash
docker compose run --rm seed
```

The one-shot `seed` service (same image as `api`) runs
`seed_production.py`, which is **additive and production-safe**: it installs
the real structure (departments, programs, teachers, HODs, the current term)
plus login accounts for every teacher/HOD and one class-rep account per
class, all with **randomly generated passwords** written to
`./seed_credentials.csv` on the host (the service bind-mounts the working
dir; the file is gitignored). It refuses to run against a database that
already has data, so re-running it later is a no-op error, not damage. Set
`ADMIN_PASSWORD` in `.env` to control the admin password (otherwise it's
random and lands in the CSV). Set `PRINCIPAL_PASSWORD` likewise for the
principal account. Distribute the credentials, tell everyone to change their
password on first login, then **delete the CSV**.

### Students

The seed also loads the real roster from `backend-erp-fastapi/students.csv`
(generate with `python tools/build_students_csv.py`). That file is **gitignored**
— it pairs 583 real names with their institutional register numbers — so a fresh
clone will not have it, and the seed then prints `No students.csv at …` and
carries on with an empty roster. Two ways to fill it:

1. **Ship it**: copy the CSV into `backend-erp-fastapi/` before `docker compose
   build`, then seed. `.dockerignore` deliberately lets `students.csv` through
   (while blocking `seed_credentials.csv`).
2. **Upload it** (preferred on a real VPS — it never puts student data inside a
   Docker image): seed without it, then log in as admin and feed the same CSV to
   the bulk-upload dialog on the Students page. It matches that dialog's schema
   exactly, which is the whole point of the format.

> `seed_production.py` refuses to run once departments exist, so there is no
> second chance to seed students via the script. If you forget the CSV on first
> boot, route 2 is the way in.

## 5. Start the stack

```bash
docker compose up -d
docker compose ps      # postgres/redis/api/web/caddy should all be healthy
docker compose logs -f api
```

Only `caddy` publishes ports to the host (80/443); `api` and `web` are
reached over the internal compose network only.

## 6. Backups & restore

The attendance records are the point of this system — tamper-evident and
meant never to be lost. The `postgres_data` volume alone is not a backup: it
dies with the disk, a bad migration, or a `down -v`. Take real logical dumps.

### Nightly backup

A profile-gated one-shot `backup` service runs `pg_dump` (custom format,
compressed) into `./backups` on the host and prunes to the most recent
`BACKUP_KEEP` dumps (default 14):

```bash
docker compose run --rm backup          # writes ./backups/scas-YYYYMMDD-HHMMSS.dump
```

Schedule it from the host's crontab — e.g. 02:30 daily:

```cron
30 2 * * * cd /srv/scas-erp && /usr/bin/docker compose run --rm backup >> /var/log/scas-backup.log 2>&1
```

`./backups` is gitignored. **Copy it off the box** — the point of a backup is
surviving the loss of this machine, so sync it to object storage or another
host (`rclone`, `aws s3 sync`, `scp`, borg…). A dump sitting only on the same
disk as the database it came from protects against almost nothing.

### Restore

Dumps are custom-format, so restore with `pg_restore`. Into the running stack's
database (drops and recreates objects — the college's data will be replaced):

```bash
# Copy the dump where the postgres container can read it, then:
docker compose exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < ./backups/scas-YYYYMMDD-HHMMSS.dump
```

For a clean rebuild (fresh volume): `docker compose down`, remove the
`postgres_data` volume, `up -d postgres`, wait for healthy, then `pg_restore`
the dump as above. Do **not** run `migrate`/`seed` first — the dump already
carries the full schema and data.

> **Drill it.** A backup you have never restored is a hypothesis. Restore the
> latest dump into a throwaway database (`createdb scratch && pg_restore -d
> scratch …`) periodically and confirm row counts look right — before you need
> it for real.

## Notes

- `DOMAIN` in `.env` needs to be a real domain you control — Caddy's
  automatic HTTPS issues a Let's Encrypt certificate for it. Local testing
  without a domain: see the commented `:80` block at the bottom of
  `Caddyfile`.
- **Sized for a 1 GB VPS.** `api` runs 2 gunicorn workers (`WEB_CONCURRENCY`,
  ~90 MB each), and every long-running container has a `mem_limit`
  (api 450m, web 250m, postgres 256m, redis 80m, caddy 96m), so a leak gets
  that one container OOM-killed and restarted rather than the kernel killing
  something random on the host. Override any cap in `.env` (see
  `.env.example`). Keep a swapfile (1–2 GB) on a box this small.
- Postgres runs with `max_connections=40` and `shared_buffers=64MB`, sized for
  2 gunicorn workers × (`db_pool_size=8` + `db_max_overflow=4`) = 24
  connections from `api`, plus headroom. If `WEB_CONCURRENCY` changes,
  re-check this math.
- Redis has AOF persistence disabled (`--appendonly no`) — it's a pure
  cache/rate-limit store, so losing it on restart is a cold cache, not data
  loss.
- Rebuilding `api` after a `requirements.txt` change or `web` after a
  `package.json` change just needs `docker compose build <service>` followed
  by `docker compose up -d <service>`.
