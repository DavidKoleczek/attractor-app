"""Project management routes and shared storage dependency."""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import Settings
from ..deps import get_settings
from ..models import ProjectConfig, StoreConfig, StoreManifest
from ..storage import ProjectStorage


# ---------------------------------------------------------------------------
# Shared helpers -- used by other route modules
# ---------------------------------------------------------------------------


def load_project_config(name: str, settings: Settings) -> ProjectConfig:
    """Read project.json for a project. Raises 404 if not found."""
    project_dir = settings.data_dir / "projects" / name
    config_path = project_dir / "project.json"
    if not config_path.exists():
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    data = json.loads(config_path.read_text())
    return ProjectConfig(**data)


def save_project_config(config: ProjectConfig, settings: Settings) -> None:
    """Write project.json for a project."""
    project_dir = settings.data_dir / "projects" / config.name
    project_dir.mkdir(parents=True, exist_ok=True)
    config_path = project_dir / "project.json"
    config_path.write_text(
        json.dumps(config.model_dump(mode="json"), indent=2, default=str) + "\n"
    )


def read_store_manifest(store_path: Path) -> StoreManifest:
    """Read .attractor-store.json from a store directory."""
    manifest_path = store_path / ".attractor-store.json"
    if not manifest_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Store manifest not found at {store_path}",
        )
    data = json.loads(manifest_path.read_text())
    return StoreManifest(**data)


def write_store_manifest(store_path: Path, store_id: str) -> None:
    """Write .attractor-store.json to a store directory."""
    manifest_path = store_path / ".attractor-store.json"
    manifest_path.write_text(json.dumps({"store_id": store_id}, indent=2) + "\n")


# ---------------------------------------------------------------------------
# Shared dependency -- imported by other route modules
# ---------------------------------------------------------------------------


def get_project_storage(
    name: str, settings: Settings = Depends(get_settings)
) -> ProjectStorage:
    """Build a ProjectStorage for the named project, raising 404 if missing."""
    config = load_project_config(name, settings)
    store_path = Path(config.store.path)
    if not store_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Store directory not found at {store_path}",
        )
    manifest = read_store_manifest(store_path)
    if manifest.store_id != config.store_id:
        raise HTTPException(
            status_code=409,
            detail="Store ID mismatch. Store may have been reassigned.",
        )
    return ProjectStorage(store_path)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class CreateProjectRequest(BaseModel):
    name: str


class ProjectInfo(BaseModel):
    name: str
    path: str
    issues_path: str
    store_id: str
    store: StoreConfig


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/")
def list_projects(settings: Settings = Depends(get_settings)) -> list[ProjectInfo]:
    """List all projects that have a project.json configuration."""
    projects_dir = settings.data_dir / "projects"
    if not projects_dir.exists():
        return []
    result: list[ProjectInfo] = []
    for entry in sorted(projects_dir.iterdir()):
        config_path = entry / "project.json"
        if entry.is_dir() and config_path.exists():
            try:
                config = ProjectConfig(**json.loads(config_path.read_text()))
                result.append(
                    ProjectInfo(
                        name=config.name,
                        path=str(entry),
                        issues_path=config.store.path,
                        store_id=config.store_id,
                        store=config.store,
                    )
                )
            except Exception:
                continue
    return result


@router.post("/", status_code=201)
def create_project(
    req: CreateProjectRequest, settings: Settings = Depends(get_settings)
) -> ProjectInfo:
    """Create a new project with a separate git-backed store."""
    project_dir = settings.data_dir / "projects" / req.name
    store_dir = settings.data_dir / "stores" / req.name
    if project_dir.exists():
        raise HTTPException(status_code=409, detail="Project already exists")

    # Generate store_id
    store_id = str(uuid.uuid4())

    # Create store directory with git init
    storage = ProjectStorage(store_dir)
    storage.init()

    # Write store manifest
    write_store_manifest(store_dir, store_id)
    storage.commit("Initialize attractor store")

    # Create project metadata
    config = ProjectConfig(
        name=req.name,
        created_at=datetime.now(timezone.utc),
        store_id=store_id,
        store=StoreConfig(path=str(store_dir.resolve())),
    )
    save_project_config(config, settings)

    return ProjectInfo(
        name=config.name,
        path=str(project_dir),
        issues_path=str(store_dir),
        store_id=store_id,
        store=config.store,
    )


@router.get("/{name}")
def get_project(name: str, settings: Settings = Depends(get_settings)) -> ProjectInfo:
    """Return basic info for a single project."""
    config = load_project_config(name, settings)
    project_dir = settings.data_dir / "projects" / name
    return ProjectInfo(
        name=config.name,
        path=str(project_dir),
        issues_path=config.store.path,
        store_id=config.store_id,
        store=config.store,
    )


@router.delete("/{name}", status_code=204)
def delete_project(name: str, settings: Settings = Depends(get_settings)) -> None:
    """Remove a project and its backing store."""
    config = load_project_config(name, settings)
    project_dir = settings.data_dir / "projects" / name

    # Delete the store directory
    store_path = Path(config.store.path)
    if store_path.exists():
        shutil.rmtree(store_path)

    # Delete project metadata
    if project_dir.exists():
        shutil.rmtree(project_dir)
