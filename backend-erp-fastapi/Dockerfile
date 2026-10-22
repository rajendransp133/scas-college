# syntax=docker/dockerfile:1
#
# SCAS ERP backend — multi-stage build.
#
# Runs gunicorn + uvicorn workers (the Phase-3 worker-model decision) inside
# Linux, where gunicorn actually works (it uses fcntl — confirmed broken on
# the Windows dev host, which is fine since it only ever needs to run here).

########################################
# Builder — installs Python deps into an isolated prefix so the runtime
# stage ships no pip/build cache/toolchain, only the installed packages.
########################################
FROM python:3.12-slim AS builder

WORKDIR /app

# No build toolchain added on purpose: every dep in requirements.txt ships a
# manylinux wheel for cpython 3.12 / linux amd64 (asyncpg, psycopg2-binary,
# bcrypt, redis[hiredis], pydantic-core) — a plain `pip install` succeeds
# without gcc/libpq-dev. If a future dependency drops binary wheels and this
# starts failing with a compiler error, add here:
#   RUN apt-get update && apt-get install -y --no-install-recommends \
#       build-essential libpq-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

########################################
# Runtime — slim image, non-root user, gunicorn entrypoint.
########################################
FROM python:3.12-slim

# Installed site-packages + console scripts (gunicorn, alembic, uvicorn, ...)
# from the builder stage.
COPY --from=builder /install /usr/local

WORKDIR /app

# Non-root: the app never needs root inside the container.
RUN groupadd --system app && useradd --system --gid app --home-dir /app app

# .dockerignore keeps attadance_system/ (the checked-in venv), __pycache__,
# .env, .git etc. out of the build context entirely — this copies app code
# only.
COPY --chown=app:app . .

USER app

EXPOSE 8000

# WEB_CONCURRENCY is read from the environment at *container start*, not
# baked in at build time, so ops can retune worker count per deploy (see
# docker-compose.yml / DEPLOY.md) without a rebuild. That needs shell-form
# expansion of `${WEB_CONCURRENCY:-2}` — a bare exec-form CMD (`CMD
# ["gunicorn", ...]`) can't expand env vars at all.
#
# Plain shell-form (`CMD gunicorn ...`) would leave `/bin/sh -c` as PID 1
# with gunicorn as its child, which does NOT reliably forward SIGTERM to
# gunicorn on `docker compose stop` — shutdown would stall until the kill
# timeout. `exec` inside the shell replaces the shell process with gunicorn,
# so gunicorn itself becomes PID 1 and receives signals directly, giving the
# same graceful-shutdown behavior exec-form CMD would have while still
# expanding the env var.
#
# --max-requests 1000 recycles each worker sooner, so slow per-process growth
# never builds up. No --preload: Sentry starts a background thread at import,
# which would not survive the fork, and CPython's refcounting dirties shared
# pages anyway, so the copy-on-write saving is small.
CMD ["sh", "-c", "exec gunicorn -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY:-2} -b 0.0.0.0:8000 --timeout 60 --graceful-timeout 30 --keep-alive 5 --max-requests 1000 --max-requests-jitter 200 main:app"]
