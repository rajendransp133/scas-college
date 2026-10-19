"""Application settings loaded from environment / .env (pydantic-settings)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


_DEV_DATABASE_URL = "postgresql+asyncpg://postgres:1234@localhost/erp_scas"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Async runtime driver (asyncpg). Alembic derives the sync URL below.
    database_url: str = _DEV_DATABASE_URL

    # "development" (default) never hard-fails on an insecure default secret;
    # "production" does — see the startup check in main.py.
    environment: str = "development"

    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12  # 12h

    # Frontend origin(s) allowed by CORS.
    cors_origins: list[str] = ["http://localhost:3000"]

    # --- connection pool ---
    # Sized per-worker: with N gunicorn workers each holding its own pool,
    # total connections = (db_pool_size + db_max_overflow) * N. Keep this
    # comfortably under Postgres' max_connections (see docker-compose.yml).
    db_pool_size: int = 8
    db_max_overflow: int = 4
    db_pool_timeout: int = 30

    # Server-side guards against a runaway query or an abandoned transaction
    # holding a pool connection (and its locks) indefinitely. Milliseconds;
    # 0 disables. Applied per connection in database/connection.py.
    db_statement_timeout_ms: int = 30_000
    db_lock_timeout_ms: int = 10_000
    db_idle_in_transaction_timeout_ms: int = 60_000

    # IANA zone the college runs in — what "today" means to every user.
    college_timezone: str = "Asia/Kolkata"

    # --- server-side caching ---
    # TTL for the small, near-static reads (settings, terms, course lookup).
    cache_ttl_seconds: int = 60
    cache_enabled: bool = True

    # Redis backs the cache (shared across workers) and rate limiting.
    # Empty falls back to a single-process in-memory implementation, which is
    # fine for local dev with one worker but wrong the moment there's more
    # than one process — see services/cache.py and main.py's limiter setup.
    redis_url: str = ""

    # Empty disables Sentry entirely (local dev default) — see main.py.
    sentry_dsn: str = ""

    @property
    def sync_database_url(self) -> str:
        """Sync URL (psycopg2) for Alembic migrations."""
        url = self.database_url
        if "+asyncpg" in url:
            return url.replace("+asyncpg", "+psycopg2")
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+psycopg2://", 1)
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

_INSECURE_JWT_SECRETS = {"", "dev-secret-change-me"}


def assert_production_ready(s: Settings = settings) -> None:
    """Fail fast rather than boot with a guessable JWT key or dev database URL.

    Only enforced when `environment=production` so the seeded dev/demo
    workflow keeps working unmodified with no `.env` changes.
    """
    if s.environment == "production" and s.jwt_secret in _INSECURE_JWT_SECRETS:
        raise RuntimeError(
            "JWT_SECRET is unset or using the insecure default while "
            "ENVIRONMENT=production. Set a real secret before starting."
        )
    if s.environment == "production" and s.database_url == _DEV_DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is unset (dev default with a guessable password) "
            "while ENVIRONMENT=production. Set the real database URL."
        )


def assert_not_production(script: str, s: Settings = settings) -> None:
    """Refuse to run a destructive dev script against a production database.

    Used by `reset_db.py`, which truncates every table. Pointing it at a live
    college database would delete the real data. `ENVIRONMENT=production`
    makes that a hard stop. (`seed_production.py` deliberately does NOT use
    this guard — it is additive-only and meant for production bootstrap.)
    """
    if s.environment == "production":
        raise RuntimeError(
            f"{script} wipes every table. It refuses to run while "
            "ENVIRONMENT=production."
        )
