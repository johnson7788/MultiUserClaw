"""Request routing — reverse-proxy from gateway to per-user nanobot containers.

Authenticated users' API requests (chat, sessions, WebSocket) are
forwarded to their individual Docker container.
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.container.manager import ensure_running
from app.db.engine import async_session, get_db
from app.db.models import User

router = APIRouter(prefix="/api/nanobot", tags=["proxy"])


async def _container_url(db: AsyncSession, user: User) -> str:
    """Get the internal URL for the user's nanobot container, starting it if needed."""
    container = await ensure_running(db, user.id)
    return f"http://{container.internal_host}:{container.internal_port}"


# ---------------------------------------------------------------------------
# HTTP reverse proxy  (catch-all for /api/nanobot/{path})
# ---------------------------------------------------------------------------

@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_http(
    path: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Forward HTTP requests to the user's nanobot container."""
    base_url = await _container_url(db, user)
    # Close the session explicitly so the connection returns to the pool
    # before the potentially long upstream call (up to 120s).
    await db.close()

    target_url = f"{base_url}/api/{path}"

    # Forward query params
    if request.query_params:
        target_url += f"?{request.query_params}"

    body = await request.body()

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                content=body,
                headers={"content-type": request.headers.get("content-type", "application/json")},
            )
        except httpx.ConnectError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Nanobot container is starting up, please retry in a few seconds",
            )

    return resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text


# ---------------------------------------------------------------------------
# WebSocket reverse proxy
# ---------------------------------------------------------------------------

@router.websocket("/ws/{session_id}")
async def proxy_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str = "",  # passed as query param ?token=xxx
):
    """Forward WebSocket connections to the user's nanobot container."""
    from app.auth.service import decode_token, get_user_by_id

    # Authenticate and resolve container URL, then release DB session immediately
    async with async_session() as db:
        payload = decode_token(token)
        if payload is None or payload.get("type") != "access":
            await websocket.close(code=4001, reason="Invalid token")
            return

        user = await get_user_by_id(db, payload["sub"])
        if user is None or not user.is_active:
            await websocket.close(code=4001, reason="User not found")
            return

        container = await ensure_running(db, user.id)
        target_ws_url = f"ws://{container.internal_host}:{container.internal_port}/ws/{session_id}"
    # DB session is now released — not held during long-lived WebSocket relay

    await websocket.accept()

    import websockets

    try:
        async with websockets.connect(target_ws_url) as upstream:
            import asyncio

            async def client_to_upstream():
                try:
                    while True:
                        data = await websocket.receive_text()
                        await upstream.send(data)
                except WebSocketDisconnect:
                    pass

            async def upstream_to_client():
                try:
                    async for message in upstream:
                        await websocket.send_text(message)
                except websockets.ConnectionClosed:
                    pass

            await asyncio.gather(client_to_upstream(), upstream_to_client())

    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
