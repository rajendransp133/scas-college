"""Cache for the small, hot, near-static reads.

Scope is deliberately narrow. Only data that (a) every page requests, (b) is
small, and (c) changes through a known set of writes is cached — the current
term and lock date, the term list, the flat course lookup, the user directory
and the department list. Attendance, students and audit are **never** cached:
they change constantly and correctness there matters more than latency.

Two backends, same public interface (`cached()` / `invalidate()` /
`invalidate_curriculum()` / `invalidate_all()`), selected by whether
`settings.redis_url` is set:

* **In-memory** (no `REDIS_URL`) — a single-process dict, single-flight via
  `asyncio.Lock`, exact invalidation. Correct only for one worker; this is
  the local-dev default so nobody needs Redis running just to boot the app.
* **Redis** (`REDIS_URL` set) — shared across every worker/replica, which is
  what makes cache invalidation actually correct once there's more than one
  process: a write on worker A invalidates the key everyone reads. This was
  the intended escape hatch from day one (see git history of this file) —
  the interface below is unchanged so no call site needed to change.
  Single-flight there is best-effort (a short `SET NX` lock, not a
  distributed queue) — a small thundering-herd window on a cold key is an
  acceptable trade-off given every cached value here is cheap to recompute.

Explicit invalidation, not TTL alone, is why `lockDate` can be cached at
all: it is read on every attendance request but only ever changed through
`set_lock_date`. The TTL is a backstop for a missed invalidation, not the
mechanism.
"""

from __future__ import annotations

import asyncio
import pickle
import time
from typing import Any, Awaitable, Callable, Optional

from config import settings

_REDIS_NAMESPACE = "cache:"


class _Entry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: Any, expires_at: float) -> None:
        self.value = value
        self.expires_at = expires_at


class _MemoryCache:
    """Single-process fallback — identical behavior to the original design."""

    def __init__(self, ttl: float) -> None:
        self._ttl = ttl
        self._data: dict[str, _Entry] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._hits = 0
        self._misses = 0

    def _fresh(self, entry: Optional[_Entry]) -> bool:
        return entry is not None and entry.expires_at > time.monotonic()

    async def get_or_load(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        ttl: Optional[float] = None,
    ) -> Any:
        entry = self._data.get(key)
        if self._fresh(entry):
            self._hits += 1
            return entry.value

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            entry = self._data.get(key)
            if self._fresh(entry):
                self._hits += 1
                return entry.value
            self._misses += 1
            value = await loader()
            self._data[key] = _Entry(
                value, time.monotonic() + (ttl if ttl is not None else self._ttl)
            )
            return value

    def invalidate(self, *prefixes: str) -> None:
        if not prefixes:
            self._data.clear()
            return
        for key in [k for k in self._data if k.startswith(prefixes)]:
            self._data.pop(key, None)

    @property
    def stats(self) -> dict[str, int]:
        total = self._hits + self._misses
        return {
            "hits": self._hits,
            "misses": self._misses,
            "entries": len(self._data),
            "hitRatePct": round(100 * self._hits / total) if total else 0,
        }


class _RedisCache:
    """Shared across every worker/replica — see the module docstring."""

    def __init__(self, ttl: float) -> None:
        self._ttl = ttl
        self._hits = 0
        self._misses = 0

    async def get_or_load(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        ttl: Optional[float] = None,
    ) -> Any:
        from services.redis_client import get_redis

        r = get_redis()
        rkey = _REDIS_NAMESPACE + key
        raw = await r.get(rkey)
        if raw is not None:
            self._hits += 1
            return pickle.loads(raw)

        # Best-effort single-flight: whoever wins the lock loads; everyone
        # else waits briefly for the value to appear, then loads anyway if
        # the lock holder never finished (crashed mid-load).
        lock_key = rkey + ":lock"
        got_lock = await r.set(lock_key, "1", nx=True, px=5000)
        if not got_lock:
            for _ in range(20):
                await asyncio.sleep(0.05)
                raw = await r.get(rkey)
                if raw is not None:
                    self._hits += 1
                    return pickle.loads(raw)

        self._misses += 1
        try:
            value = await loader()
            await r.set(
                rkey, pickle.dumps(value), ex=int(ttl if ttl is not None else self._ttl)
            )
            return value
        finally:
            if got_lock:
                await r.delete(lock_key)

    def invalidate(self, *prefixes: str) -> None:
        # Fire-and-forget: invalidation is a Redis round-trip, but every
        # existing call site calls `invalidate(...)` synchronously (not
        # awaited) as part of the in-memory-cache interface. Scheduling the
        # actual delete as a task keeps that interface unchanged; it lands
        # within the same event loop tick or two, which is an acceptable
        # trade-off for these low-value, cheap-to-recompute cached reads.
        asyncio.create_task(self._invalidate_async(*prefixes))

    async def _invalidate_async(self, *prefixes: str) -> None:
        from services.redis_client import get_redis

        r = get_redis()
        patterns = (
            [f"{_REDIS_NAMESPACE}*"]
            if not prefixes
            else [f"{_REDIS_NAMESPACE}{p}*" for p in prefixes]
        )
        for pattern in patterns:
            cursor = 0
            while True:
                cursor, keys = await r.scan(cursor=cursor, match=pattern, count=200)
                real_keys = [k for k in keys if not k.endswith(b":lock")]
                if real_keys:
                    await r.delete(*real_keys)
                if cursor == 0:
                    break

    @property
    def stats(self) -> dict[str, int]:
        total = self._hits + self._misses
        return {
            "hits": self._hits,
            "misses": self._misses,
            "entries": -1,  # not tracked per-process for the shared backend
            "hitRatePct": round(100 * self._hits / total) if total else 0,
        }


cache = _RedisCache(ttl=settings.cache_ttl_seconds) if settings.redis_url else _MemoryCache(
    ttl=settings.cache_ttl_seconds
)


async def cached(key: str, loader: Callable[[], Awaitable[Any]], ttl: float | None = None):
    """Read `key` from the cache, loading it via `loader` on a miss."""
    if not settings.cache_enabled:
        return await loader()
    return await cache.get_or_load(key, loader, ttl)


# --- invalidation groups -------------------------------------------------
# Named so call sites read as intent ("the curriculum changed") rather than
# as a list of string prefixes.

SETTINGS = "settings"
TERMS = "terms"
COURSES = "courses"
DIRECTORY = "directory"
DEPARTMENTS = "departments"
ASSIGNMENTS = "assignments"


def invalidate(*groups: str) -> None:
    cache.invalidate(*groups)


def invalidate_curriculum() -> None:
    """Departments/programs/semesters/courses all feed the course lookup."""
    cache.invalidate(COURSES, DEPARTMENTS)


def invalidate_all() -> None:
    cache.invalidate()
