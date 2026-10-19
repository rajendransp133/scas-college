import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from config import assert_production_ready, settings
from database.connection import async_session, engine
from logging_config import setup_logging
from middleware import ETagMiddleware, RequestLoggingMiddleware, ServerErrorsMiddleware
from rate_limit import limiter

setup_logging()
assert_production_ready()

if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(dsn=settings.sentry_dsn, traces_sample_rate=0.1)

from routers import (  # noqa: E402  (after logging/Sentry are configured)
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    # Close pooled connections on shutdown instead of leaving Postgres to time
    # them out — matters on every rolling restart with several workers.
    await engine.dispose()


app = FastAPI(title="SCAS ERP API", version="1.0.0", lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code >= 500:
        logger.error("HTTP %s on %s: %s", exc.status_code, request.url.path, exc.detail)
    # Keep the exception's headers — `WWW-Authenticate: Bearer` on a 401 was
    # being dropped here.
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None),
    )


# Middleware, innermost first (each add_middleware wraps everything before it).
# See middleware.py for why the order is what it is.
app.add_middleware(ETagMiddleware)
# JSON list responses compress extremely well — repeated camelCase keys — so
# this is the cheapest bandwidth win available. 500 bytes is below the size
# where compression stops paying for its own CPU.
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(ServerErrorsMiddleware)
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

# Outermost, so it logs the status actually sent to the client (a 304 from the
# ETag middleware, a 429 from the rate limiter, a 500 from ServerErrors).
app.add_middleware(RequestLoggingMiddleware)


@app.get("/health", tags=["meta"])
async def health():
    """Liveness: the process is up and serving. No dependency checks — a slow or
    briefly-unreachable database must not make the orchestrator kill the pod."""
    return {"status": "ok"}


# A readiness probe must answer fast either way; without a bound it waited out
# the pool timeout (30s) behind a dead database.
_READY_TIMEOUT_S = 3.0


@app.get("/health/ready", tags=["meta"])
async def readiness():
    """Readiness: can this instance actually serve requests? Verifies the
    database (and Redis, when configured) so a container whose dependencies are
    down reports *not ready* (503) instead of accepting traffic it can only 500.
    This is what the compose healthcheck targets — `/health` alone stays green
    with a dead database."""
    checks: dict[str, str] = {}

    async def _db() -> None:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))

    try:
        await asyncio.wait_for(_db(), _READY_TIMEOUT_S)
        checks["database"] = "ok"
    except Exception:
        logger.exception("Readiness: database check failed")
        checks["database"] = "error"

    if settings.redis_url:
        try:
            from services.redis_client import get_redis

            await asyncio.wait_for(get_redis().ping(), _READY_TIMEOUT_S)
            checks["redis"] = "ok"
        except Exception:
            logger.exception("Readiness: redis check failed")
            checks["redis"] = "error"

    ready = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=(
            status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE
        ),
        content={"status": "ready" if ready else "degraded", "checks": checks},
    )


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
