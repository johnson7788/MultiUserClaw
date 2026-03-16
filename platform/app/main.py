"""Platform Gateway — main FastAPI application."""

import asyncio
import logging
from contextlib import asynccontextmanager
from urllib.parse import urlparse, urlunparse

import asyncpg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.engine import engine
from app.db.models import Base
from app.logging_setup import setup_logging, log_settings_summary
from app.routes import auth, llm, proxy, admin

setup_logging()
logger = logging.getLogger(__name__)


async def _ensure_database() -> None:
    """Connect to the default 'postgres' DB and create the target database if missing."""
    parsed = urlparse(settings.database_url)
    db_name = parsed.path.lstrip("/")
    # Build a URL pointing to the default 'postgres' database
    admin_url = urlunparse(parsed._replace(path="/postgres"))
    # asyncpg uses postgresql:// not postgresql+asyncpg://
    admin_url = admin_url.replace("postgresql+asyncpg://", "postgresql://", 1)

    max_retries = 30
    for attempt in range(1, max_retries + 1):
        try:
            conn = await asyncpg.connect(admin_url)
            break
        except (OSError, asyncpg.PostgresError) as exc:
            if attempt == max_retries:
                raise RuntimeError(
                    f"Cannot connect to PostgreSQL after {max_retries} attempts"
                ) from exc
            logger.warning("Waiting for PostgreSQL (attempt %d/%d): %s", attempt, max_retries, exc)
            await asyncio.sleep(2)

    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1", db_name
        )
        if not exists:
            # CREATE DATABASE cannot run inside a transaction
            await conn.execute(f'CREATE DATABASE "{db_name}"')
            logger.info("Created database '%s'", db_name)
        else:
            logger.info("Database '%s' already exists", db_name)
    finally:
        await conn.close()


async def _ensure_admin_user() -> None:
    """Create the default admin user if configured and not yet existing."""
    if not settings.admin_username or not settings.admin_password:
        return

    from app.auth.service import get_user_by_username, hash_password
    from app.db.engine import async_session
    from app.db.models import User

    async with async_session() as db:
        existing = await get_user_by_username(db, settings.admin_username)
        if existing:
            # Ensure the user has admin role
            if existing.role != "admin":
                existing.role = "admin"
                await db.commit()
                logger.info("Updated user '%s' role to admin", settings.admin_username)
            else:
                logger.info("Admin user '%s' already exists", settings.admin_username)
            return

        user = User(
            username=settings.admin_username,
            email=f"{settings.admin_username}@localhost",
            password_hash=hash_password(settings.admin_password),
            role="admin",
        )
        db.add(user)
        await db.commit()
        logger.info("Created admin user '%s'", settings.admin_username)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log_settings_summary()
    # Ensure the target database exists before creating tables
    await _ensure_database()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables verified")
    await _ensure_admin_user()
    yield
    await engine.dispose()


app = FastAPI(
    title="OpenClaw Platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount route groups
app.include_router(auth.router)
app.include_router(llm.router)
app.include_router(proxy.router)
app.include_router(admin.router)


@app.get("/api/ping")
async def ping():
    return {"message": "pong", "service": "openclaw-platform"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.host, port=settings.port)
