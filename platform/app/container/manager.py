"""Docker container lifecycle management for per-user openclaw instances."""

from __future__ import annotations

import secrets
from pathlib import Path

import docker
from docker.errors import APIError as DockerAPIError, NotFound as DockerNotFound
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import Container

_client: docker.DockerClient | None = None


def _docker() -> docker.DockerClient:
    global _client
    if _client is None:
        _client = docker.from_env()
    return _client


def _ensure_network() -> None:
    """Create the internal Docker network if it doesn't exist."""
    client = _docker()
    try:
        client.networks.get(settings.container_network)
    except DockerNotFound:
        client.networks.create(
            settings.container_network,
            driver="bridge",
            internal=False,  # allow internet access for tool downloads
        )


async def get_container(db: AsyncSession, user_id: str) -> Container | None:
    result = await db.execute(select(Container).where(Container.user_id == user_id))
    return result.scalar_one_or_none()


async def get_container_by_token(db: AsyncSession, token: str) -> Container | None:
    result = await db.execute(select(Container).where(Container.container_token == token))
    return result.scalar_one_or_none()


async def create_container(db: AsyncSession, user_id: str) -> Container | None:
    """Create a Docker container for a user and record metadata in DB.

    Inserts a DB record first to claim the user_id slot (preventing races),
    then creates the Docker container and updates the record.
    Returns None if another request already claimed the slot.
    """
    container_token = secrets.token_urlsafe(32)
    short_id = user_id[:8]

    # Insert DB record to claim the unique user_id slot.
    # ON CONFLICT DO NOTHING avoids PostgreSQL ERROR logs on races.
    stmt = (
        pg_insert(Container)
        .values(
            user_id=user_id,
            docker_id="",
            container_token=container_token,
            status="creating",
            internal_host="",
            internal_port=18080,
        )
        .on_conflict_do_nothing(index_elements=["user_id"])
        .returning(Container.__table__.c.id)
    )
    result = await db.execute(stmt)
    row = result.first()
    if row is None:
        # Another request already claimed this user_id — not an error
        return None

    await db.flush()
    record = await get_container(db, user_id)

    # Now safe to create Docker resources — we hold the DB slot.
    _ensure_network()
    client = _docker()

    data_vol = f"openclaw-data-{short_id}"
    container_name = f"openclaw-user-{short_id}"

    # Remove any stale container with the same name
    try:
        stale = client.containers.get(container_name)
        stale.remove(force=True)
    except DockerNotFound:
        pass

    try:
        docker_container = client.containers.run(
            image=settings.openclaw_image,
            command=["node", "bridge/dist/start.js"],
            name=container_name,
            detach=True,
            environment={
                "NANOBOT_PROXY__URL": f"http://gateway:8080/llm/v1",
                "NANOBOT_PROXY__TOKEN": container_token,
                "NANOBOT_AGENTS__DEFAULTS__MODEL": settings.default_model,
                "TZ": settings.container_tz,
                # Force-enable channel startup inside user containers.
                # bridge/start.ts will skip injecting OPENCLAW_SKIP_CHANNELS=1
                # when BRIDGE_ENABLE_CHANNELS is set to "1".
                "BRIDGE_ENABLE_CHANNELS": "1",
            },
            mounts=[
                docker.types.Mount("/root/.openclaw", data_vol, type="volume"),
            ],
            network=settings.container_network,
            mem_limit=settings.container_memory_limit,
            nano_cpus=int(settings.container_cpu_limit * 1e9),
            pids_limit=settings.container_pids_limit,
            restart_policy={"Name": "unless-stopped"},
        )
    except Exception:
        # Docker creation failed — remove the placeholder DB record
        await db.rollback()
        raise

    # Read container IP on the internal network
    docker_container.reload()
    network_settings = docker_container.attrs["NetworkSettings"]["Networks"]
    internal_ip = network_settings.get(settings.container_network, {}).get("IPAddress", "")

    record.docker_id = docker_container.id
    record.status = "running"
    record.internal_host = internal_ip
    await db.commit()
    await db.refresh(record)
    return record


async def ensure_running(db: AsyncSession, user_id: str) -> Container:
    """Return a running container for the user, creating or unpausing as needed."""
    import asyncio

    record = await get_container(db, user_id)

    if record is None:
        created = await create_container(db, user_id)
        if created is not None:
            return created
        # Race condition: another request created the container first
        record = await get_container(db, user_id)
        if record is None:
            raise RuntimeError("Failed to create or find container")

    # Another request is still creating the container — wait for it
    if record.status == "creating":
        for _ in range(30):  # wait up to 60s
            await asyncio.sleep(2)
            await db.expire(record)
            record = await get_container(db, user_id)
            if record is None or record.status != "creating":
                break
        if record is None:
            return await create_container(db, user_id)
        if record.status == "creating":
            raise RuntimeError("Container creation timed out")

    client = _docker()

    if record.status == "paused":
        try:
            c = client.containers.get(record.docker_id)
            c.unpause()
            await db.execute(
                update(Container)
                .where(Container.id == record.id)
                .values(status="running")
            )
            await db.commit()
            record.status = "running"
        except DockerNotFound:
            # Container was removed externally — recreate
            await db.delete(record)
            await db.commit()
            created = await create_container(db, user_id)
            if created is not None:
                return created
            record = await get_container(db, user_id)
            if record is not None:
                return record
            raise RuntimeError("Failed to recreate container")

    elif record.status == "archived":
        # Recreate from persisted data volumes
        await db.delete(record)
        await db.commit()
        created = await create_container(db, user_id)
        if created is not None:
            return created
        record = await get_container(db, user_id)
        if record is not None:
            return record
        raise RuntimeError("Failed to recreate container")

    elif record.status == "running":
        # Verify it's actually running
        try:
            c = client.containers.get(record.docker_id)
            if c.status != "running":
                c.start()
        except DockerNotFound:
            await db.delete(record)
            await db.commit()
            created = await create_container(db, user_id)
            if created is not None:
                return created
            record = await get_container(db, user_id)
            if record is not None:
                return record
            raise RuntimeError("Failed to recreate container")

    return record


async def pause_container(db: AsyncSession, user_id: str) -> bool:
    """Pause a user's container to save resources."""
    record = await get_container(db, user_id)
    if record is None or record.status != "running":
        return False

    client = _docker()
    try:
        c = client.containers.get(record.docker_id)
        c.pause()
        await db.execute(
            update(Container).where(Container.id == record.id).values(status="paused")
        )
        await db.commit()
        return True
    except DockerNotFound:
        return False


async def destroy_container(db: AsyncSession, user_id: str) -> bool:
    """Stop and remove a user's container (data volumes are preserved)."""
    record = await get_container(db, user_id)
    if record is None:
        return False

    client = _docker()
    try:
        c = client.containers.get(record.docker_id)
        c.stop(timeout=10)
        c.remove()
    except DockerNotFound:
        pass

    await db.delete(record)
    await db.commit()
    return True
