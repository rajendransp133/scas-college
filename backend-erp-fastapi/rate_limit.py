"""Rate limiting (slowapi). Storage is Redis when configured, in-memory
otherwise — in-memory is only correct with a single worker process (see
config.py's `redis_url` docstring); the moment there's more than one worker,
each holds its own counter and a client effectively gets N times the budget.

Key function: `get_ipaddr` (not slowapi's more commonly used
`get_remote_address`) because in the Docker Compose deploy the API sits
behind the Caddy reverse proxy (see ../Caddyfile) and is never published to
the host itself — `request.client.host` as seen by uvicorn would be Caddy's
own container IP for every request, collapsing the per-client rate limit
into one shared bucket. `get_ipaddr` reads `X-Forwarded-For` instead, which
Caddy sets to the true remote address on every hop. This is only safe
because nothing but Caddy can reach this service directly (no `ports:` on
`api` in docker-compose.yml) — if that ever changes (e.g. exposing the API
to the host for local debugging), an untrusted caller could spoof
`X-Forwarded-For` and dodge the limiter.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_ipaddr

from config import settings

limiter = Limiter(
    key_func=get_ipaddr,
    storage_uri=settings.redis_url or "memory://",
)
