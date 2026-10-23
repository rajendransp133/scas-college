"""Rate limiting (slowapi). Storage is Redis when configured, in-memory
otherwise — in-memory is only correct with a single worker process (see
config.py's `redis_url` docstring); the moment there's more than one worker,
each holds its own counter and a client effectively gets N times the budget.

Key function: `client_ip`, the first `X-Forwarded-For` entry. In the Docker
Compose deploy the API sits behind Caddy (see ../Caddyfile) and is never
published to the host itself, so `request.client.host` as seen by uvicorn is
Caddy's own container IP for every request — keying on it collapses the
per-client limit into one bucket shared by the whole college.

slowapi's own `get_ipaddr` was used here before and did exactly that: it looks
up the header as `X_FORWARDED_FOR`, which never matches a real
`X-Forwarded-For`, so it always fell through to `request.client.host`.

Why the *first* entry: each proxy appends the peer it received from, so the
leftmost value is the original client. That holds for both deploys — Caddy at
the edge (docker-compose.yml) sets the header to the real remote address, and
behind host nginx (docker-compose.local.yml on the VPS) nginx overwrites it
with `$remote_addr` and Caddyfile.local trusts nginx (`trusted_proxies`) so
Caddy appends rather than replaces. Safe only because nothing but the proxy
chain can reach this service to forge the header (no `ports:` on `api`).
"""

from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request

from config import settings


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


limiter = Limiter(
    key_func=client_ip,
    storage_uri=settings.redis_url or "memory://",
)
