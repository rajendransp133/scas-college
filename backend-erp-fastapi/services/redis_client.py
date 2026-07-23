"""Shared async Redis client for services/cache.py and rate_limit.py.

Only constructed when `settings.redis_url` is set. Local single-worker dev
has no Redis dependency at all — see cache.py's in-memory fallback.
"""

from __future__ import annotations

from redis import asyncio as aioredis

from config import settings

_client: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _client
    if _client is None:
        if not settings.redis_url:
            raise RuntimeError("REDIS_URL is not configured")
        _client = aioredis.from_url(settings.redis_url, decode_responses=False)
    return _client
