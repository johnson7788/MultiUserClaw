"""Database engine and session management."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=20,
    max_overflow=20,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=True,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields an async database session."""
    async with async_session() as session:
        yield session
