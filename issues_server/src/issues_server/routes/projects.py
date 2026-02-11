"""Project management routes and shared storage dependency."""

from __future__ import annotations

import shutil

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import Settings
from ..deps import get_settings
from ..storage import ProjectStorage

router = APIRouter(prefix="/projects", tags=["projects"])


# ---------------------------------------------------------------------------
# Shared dependency -- imported by other route modules
# ---------------------------------------------------------------------------


def get_project_storage(
    name: str, settings: Settings = Depends(get_settings)
) -> ProjectStorage:
    """Build a ProjectStorage for the named project, raising 404 if missing."""
    storage = ProjectStorage(settings.data_dir / "projects" / name)
    if not storage.exists():
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    return storage


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class CreateProjectRequest(BaseModel):
    name: str


class ProjectInfo(BaseModel):
    name: str
    path: str
    issues_path: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ProjectInfo])
def list_projects(settings: Settings = Depends(get_settings)) -> list[ProjectInfo]:
    """List all projects that have an initialised git repository."""
    projects_dir = settings.data_dir / "projects"
    if not projects_dir.exists():
        return []
    return [
        ProjectInfo(
            name=entry.name,
            path=str(entry.resolve()),
            issues_path=str((entry / "issues").resolve()),
        )
        for entry in sorted(projects_dir.iterdir())
        if entry.is_dir() and (entry / ".git").is_dir()
    ]


@router.post("", response_model=ProjectInfo, status_code=201)
def create_project(
    body: CreateProjectRequest,
    settings: Settings = Depends(get_settings),
) -> ProjectInfo:
    """Create a new project with an empty git-backed store."""
    project_path = settings.data_dir / "projects" / body.name
    if project_path.exists():
        raise HTTPException(
            status_code=409, detail=f"Project '{body.name}' already exists"
        )

    storage = ProjectStorage(project_path)
    storage.init()
    return ProjectInfo(
        name=body.name,
        path=str(project_path.resolve()),
        issues_path=str((project_path / "issues").resolve()),
    )


@router.get("/{name}", response_model=ProjectInfo)
def get_project(
    storage: ProjectStorage = Depends(get_project_storage),
) -> ProjectInfo:
    """Return basic info for a single project."""
    return ProjectInfo(
        name=storage.path.name,
        path=str(storage.path.resolve()),
        issues_path=str((storage.path / "issues").resolve()),
    )


@router.delete("/{name}", status_code=204)
def delete_project(
    name: str,
    settings: Settings = Depends(get_settings),
) -> None:
    """Remove a project and all its data."""
    project_path = settings.data_dir / "projects" / name
    if not project_path.exists() or not (project_path / ".git").is_dir():
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    shutil.rmtree(project_path)
