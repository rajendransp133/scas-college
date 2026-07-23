import hashlib
import logging
import time

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from config import assert_production_ready, settings
from logging_config import request_logger, setup_logging
from rate_limit import limiter

setup_logging()
assert_production_ready()

if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(dsn=settings.sentry_dsn, traces_sample_rate=0.1)

from routers import (
    assignments,
    attendance,
    auth,
    courses,
    departments,
    integrity,
    materials,
    programs,
    semesters,
    stats,
    students,
    teachers,
    terms,
    users,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="SCAS ERP API", version="1.0.0")


async def request_logging_middleware(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    duration_ms = round((time.monotonic() - start) * 1000, 1)
    user_id = getattr(request.state, "user_id", None)
    request_logger.info(
        "request",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "durationMs": duration_ms,
            "userId": user_id,
        },
    )
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code >= 500:
        logger.error("HTTP %s on %s: %s", exc.status_code, request.url.path, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )

# Responses larger than this aren't buffered for hashing (file downloads).
_ETAG_MAX_BYTES = 1024 * 1024


async def _read_body(response) -> bytes | None:
    """Body bytes for either a streaming or an already-materialised response.

    Error responses raised inside the stack are plain `Response` objects with a
    `.body` and no `.body_iterator`; reading the wrong one raises *inside* the
    ASGI callable, which breaks the protocol and resets the connection instead
    of surfacing the original error.
    """
    iterator = getattr(response, "body_iterator", None)
    if iterator is not None:
        return b"".join([chunk async for chunk in iterator])
    body = getattr(response, "body", None)
    return bytes(body) if body is not None else None


@app.middleware("http")
async def etag_middleware(request: Request, call_next):
    """Conditional GETs: hash the body into an ETag and answer repeat requests
    with 304 (no body).

    Cheap on the server and removes the transfer entirely for the many small,
    rarely-changing reads (settings, terms, courses, directory) that every page
    requests on every navigation.
    """
    response = await call_next(request)
    if request.method != "GET" or response.status_code != 200:
        return response
    if not response.headers.get("content-type", "").startswith("application/json"):
        return response

    body = await _read_body(response)
    if body is None:
        return response

    headers = dict(response.headers)
    if len(body) > _ETAG_MAX_BYTES:
        headers["content-length"] = str(len(body))
        return Response(
            content=body,
            status_code=200,
            headers=headers,
            media_type=response.media_type,
        )

    etag = f'W/"{hashlib.md5(body).hexdigest()}"'
    headers["etag"] = etag
    # Always revalidate: correctness first — the 304 is what saves the bytes,
    # not a stale window in which the client skips asking.
    headers.setdefault("cache-control", "private, no-cache, must-revalidate")

    if request.headers.get("if-none-match") == etag:
        headers.pop("content-length", None)
        headers.pop("content-type", None)
        return Response(status_code=304, headers=headers)

    headers["content-length"] = str(len(body))
    return Response(
        content=body,
        status_code=200,
        headers=headers,
        media_type=response.media_type,
    )


# Registered *after* the ETag middleware so it ends up outside it: the ETag is
# computed over the raw JSON, then the result (or the empty 304) is compressed.
# JSON list responses compress extremely well — repeated camelCase keys — so
# this is the cheapest bandwidth win available. 500 bytes is below the size
# where compression stops paying for its own CPU.
app.add_middleware(GZipMiddleware, minimum_size=500)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    # Narrowed to what the app actually sends/receives, not a wildcard.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    # ETag is not a CORS-safelisted response header — without this the browser
    # hides it from JS and conditional requests silently stop working.
    expose_headers=["ETag"],
    # If-None-Match is what makes the ETag middleware's conditional GETs work
    # cross-origin; without listing it explicitly the browser strips it.
    allow_headers=["Authorization", "Content-Type", "If-None-Match"],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Registered last so it wraps everything above: it logs the actual status
# code sent to the client (a 304 from the ETag middleware, a 429 from the
# rate limiter), not the route handler's raw pre-middleware response.
app.add_middleware(BaseHTTPMiddleware, dispatch=request_logging_middleware)


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok"}


for _module in (
    auth,
    departments,
    programs,
    semesters,
    courses,
    students,
    teachers,
    terms,
    assignments,
    attendance,
    integrity,
    materials,
    stats,
    users,
):
    app.include_router(_module.router)
