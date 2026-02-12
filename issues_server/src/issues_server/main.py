"""FastAPI application entry point.

Run with: uv run fastapi dev src/issues_server/main.py
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .deps import get_settings, get_ws_manager
from .routes import (
    amplifier,
    comments,
    config,
    filesystem,
    github_auth,
    issues,
    labels,
    projects,
    store,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    settings = get_settings()
    projects_dir = settings.data_dir / "projects"
    projects_dir.mkdir(parents=True, exist_ok=True)
    stores_dir = settings.data_dir / "stores"
    stores_dir.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Attractor Issues Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API routes (all under /api) -------------------------------------------

app.include_router(projects.router, prefix="/api")
app.include_router(issues.router, prefix="/api")
app.include_router(comments.router, prefix="/api")
app.include_router(labels.router, prefix="/api")
app.include_router(amplifier.router, prefix="/api")
app.include_router(github_auth.router, prefix="/api")
app.include_router(store.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(filesystem.router, prefix="/api")


# --- WebSocket --------------------------------------------------------------


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    manager = get_ws_manager()
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(ws)


# --- Static files (SPA fallback) -------------------------------------------

settings = get_settings()
if settings.frontend_dir.exists():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True))
