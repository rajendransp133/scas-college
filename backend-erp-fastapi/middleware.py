"""Pure-ASGI middleware: conditional GETs, request logging, last-resort 500s.

These used to be `BaseHTTPMiddleware` / `@app.middleware("http")` layers.
That base class runs each request through an extra task and an in-memory
stream per layer, and three stacked layers showed up as overhead on every
request. Raw ASGI callables cost a function call.

Order matters and is set in `main.py`. From the outside in:

    RequestLogging → SlowAPI → CORS → ServerErrors → GZip → ETag → app

* **ServerErrors sits inside CORS.** Starlette routes an `Exception` handler
  through `ServerErrorMiddleware`, which is outside every user middleware. So
  a 500 went out with no CORS headers, and the browser reported a CORS error
  instead of the real failure. Catching it here, inside CORS, fixes that.
* **ETag sits inside GZip.** It hashes the raw JSON, then the response (or the
  empty 304) is compressed.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from config import settings
from logging_config import request_logger

logger = logging.getLogger(__name__)


class ETagMiddleware:
    """Hash JSON GET bodies into a weak ETag; answer a matching
    `If-None-Match` with 304 and no body.

    Cheap on the server, and it removes the transfer entirely for the small,
    rarely-changing reads (settings, terms, courses, directory) that every
    page requests on every navigation. Only 200 JSON GETs are buffered;
    anything else, or a body over `max_bytes`, streams through untouched.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = 1024 * 1024) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "GET":
            await self.app(scope, receive, send)
            return

        if_none_match = Headers(scope=scope).get("if-none-match")
        start: Message | None = None
        chunks: list[bytes] = []
        size = 0
        passthrough = False

        async def flush_buffered() -> None:
            await send(start)
            await send({"type": "http.response.body", "body": b"".join(chunks), "more_body": True})

        async def wrapped(message: Message) -> None:
            nonlocal start, size, passthrough
            if passthrough:
                await send(message)
                return

            if message["type"] == "http.response.start":
                content_type = Headers(raw=message["headers"]).get("content-type", "")
                if message["status"] != 200 or not content_type.startswith("application/json"):
                    passthrough = True
                    await send(message)
                    return
                start = message
                return

            if message["type"] != "http.response.body":
                await send(message)
                return

            chunk = message.get("body", b"")
            chunks.append(chunk)
            size += len(chunk)
            if size > self.max_bytes:
                # Too big to be worth hashing: hand over what we have and stream
                # the rest.
                passthrough = True
                await flush_buffered()
                await send({"type": "http.response.body", "body": b"", "more_body": message.get("more_body", False)})
                return
            if message.get("more_body", False):
                return

            body = b"".join(chunks)
            etag = f'W/"{hashlib.md5(body).hexdigest()}"'
            headers = MutableHeaders(raw=list(start["headers"]))
            headers["etag"] = etag
            # Always revalidate: correctness first — the 304 is what saves the
            # bytes, not a stale window in which the client skips asking.
            if "cache-control" not in headers:
                headers["cache-control"] = "private, no-cache, must-revalidate"

            if if_none_match == etag:
                del headers["content-length"]
                del headers["content-type"]
                await send({"type": "http.response.start", "status": 304, "headers": headers.raw})
                await send({"type": "http.response.body", "body": b""})
                return

            headers["content-length"] = str(len(body))
            await send({"type": "http.response.start", "status": 200, "headers": headers.raw})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, wrapped)


class ServerErrorsMiddleware:
    """Turn an unhandled exception into a uniform `{"detail": ...}` 500,
    logged with its stack trace (and sent to Sentry when configured)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False

        async def wrapped(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, wrapped)
        except Exception as exc:
            logger.exception("Unhandled error on %s %s", scope["method"], scope["path"])
            if settings.sentry_dsn:
                import sentry_sdk

                sentry_sdk.capture_exception(exc)
            if started:
                raise  # too late for a clean response; let the server close it
            body = json.dumps({"detail": "Internal server error"}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})


class RequestLoggingMiddleware:
    """One structured log line per request: method, path, the status actually
    sent (a 304 from ETag, a 429 from the limiter), duration and user id.

    `deps.get_current_user` stashes the id on `request.state`, which Starlette
    keeps in `scope["state"]` — so it's readable here once the app returns.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started_at = time.monotonic()
        status_code = 500

        async def wrapped(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, wrapped)
        finally:
            state = scope.get("state") or {}
            request_logger.info(
                "request",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status_code,
                    "durationMs": round((time.monotonic() - started_at) * 1000, 1),
                    "userId": state.get("user_id") if isinstance(state, dict) else None,
                },
            )
