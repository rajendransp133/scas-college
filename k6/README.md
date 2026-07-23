# Load tests — Phase 6: validating ~500-concurrent-user readiness

Four scripts, one per documented hot path. Each ramps to the plan's target
concurrency and checks against the plan's pass bar.

## Prerequisites

- The stack running somewhere reachable (either `docker compose up` locally,
  per the root `DEPLOY.md`, or the real VPS) — **not** the dev `--reload`
  single-process server. These numbers are meaningless against a single
  uvicorn worker; they're validating the Phase 3/4 multi-worker + Redis +
  container setup.
- [k6](https://k6.io/) installed (`k6 version` to check).
- A populated database. The synthetic large seed (`seed_large.py`, ~4.8k
  students / 4M attendance records) was removed along with the demo seeds —
  `students-search.js` and `attendance-summary.js` only reflect real scale
  once the app holds a comparable volume of real data.
- Real credentials: the demo logins are gone, so every script requires
  `-e EMAIL=... -e PASSWORD=...` (an account from `seed_production.py`'s
  credentials CSV, or any account you created).

## Running

```bash
k6 run -e BASE_URL=https://api.your-domain.example -e EMAIL=... -e PASSWORD=... k6/login.js
k6 run -e BASE_URL=https://api.your-domain.example -e EMAIL=... -e PASSWORD=... k6/students-search.js
k6 run -e BASE_URL=https://api.your-domain.example -e EMAIL=... -e PASSWORD=... k6/attendance-summary.js
k6 run -e BASE_URL=https://api.your-domain.example -e EMAIL=... -e PASSWORD=... k6/mark-attendance.js
```

Default `BASE_URL` is `http://localhost:8000` if omitted (a local
`docker compose up` stack's `api` service published directly, or through
Caddy on `:80`/`:443` — either works, just point at the right port).

## The rate limiter will dominate `login.js` from a single machine

`/auth/login` is limited to 10/minute **per client IP**
(`backend-erp-fastapi/rate_limit.py`). k6 running from one machine (or one
cloud runner) presents as one IP, so a 500-VU ramp will mostly see `429`s —
that's the limiter doing its job, not a bug. `login.js` treats `429` as a
non-error for exactly this reason, so it still validates that the requests
which *do* get through keep flat p95/p99 latency (the actual point of this
script: proving the Phase 0 blocking-bcrypt fix). To measure raw
auth-endpoint capacity independent of the limiter, either:

- run k6 in [cloud/distributed mode](https://k6.io/docs/cloud/) so requests
  come from many real IPs, or
- temporarily bump the limit in `rate_limit.py` / point `REDIS_URL` at a
  scratch Redis and flush it between runs, for this test only — don't leave
  the limit raised in anything resembling production config.

## Pass bar (from the plan — not open-ended)

| Metric | Reads (`login`, `students-search`, `attendance-summary`) | Writes (`mark-attendance`) |
|---|---|---|
| p95 latency | < 500ms | < 800ms |
| p99 latency | < 1000ms | < 1500ms |
| Error rate (5xx) | < 0.1% | < 0.1% |

Each script's `thresholds` block enforces these — a `k6 run` exits non-zero
if a threshold is breached, so these are CI/scripting-friendly, not just
eyeballed.

Also watch, on the server side, during each run:

- **Postgres connections** (`SELECT count(*) FROM pg_stat_activity;`) against
  `max_connections` (150 in `docker-compose.yml`, per the Phase 3 pool math:
  4 gunicorn workers × 12 max connections/worker = 48 possible, comfortable
  headroom — if this run pushes noticeably higher than expected, the pool
  math needs revisiting, not just the worker count).
- **Memory per gunicorn worker** (`docker stats`) — catches a leak or an
  oversized per-request allocation before it's a production incident.
- **Redis cache hit rate** — `services/cache.py`'s `cache.stats` property
  (not currently exposed via an endpoint; the quickest way to check during a
  run is a one-off `docker compose exec api python -c "from services.cache
  import cache; print(cache.stats)"`, or wire up a debug-only endpoint if
  you'll be doing this repeatedly).

## Iterate, don't one-shot

If a run breaks the bar: check which of the three levers above explains it
(worker count, pool size, cache TTL/hit rate), adjust, redeploy, re-run. This
is the last phase of the plan specifically because it needs Phases 3-4
actually deployed to produce numbers that mean anything — treat a first
failing run as expected, not alarming.
