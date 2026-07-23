from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from config import settings

# Async engine (asyncpg). expire_on_commit=False keeps ORM objects usable
# after commit without re-querying.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    # A single uvicorn worker serves many concurrent requests off one event
    # loop, so the pool — not the process count — is what caps DB concurrency.
    # The default (5 + 10 overflow) makes a dashboard load, which fires several
    # aggregate queries at once, queue behind itself.
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout,
    # Recycle before Postgres' idle timeout so a dead socket is never handed out.
    pool_recycle=1800,
    pool_pre_ping=True,
    connect_args={"server_settings": {"application_name": "scas-erp-api"}},
)
async_session = async_sessionmaker(
    engine, expire_on_commit=False, class_=AsyncSession
)


async def get_db():
    """FastAPI dependency that provides a database session."""
    async with async_session() as session:
        yield session
