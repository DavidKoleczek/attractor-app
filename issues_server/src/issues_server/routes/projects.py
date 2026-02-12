"""Project management routes and shared storage dependency."""

from __future__ import annotations

import json
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..config import Settings
from ..deps import get_settings
from ..github_client import GitHubClient
from ..models import GitHubStoreConfig, ProjectConfig, StoreConfig, StoreManifest
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
    mode: Literal["empty", "folder", "github"] = "empty"
    path: str | None = None
    owner: str | None = None
    repo: str | None = None


class ProjectInfo(BaseModel):
    name: str
    path: str
    issues_path: str
    store_id: str
    store: StoreConfig
    project_path: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
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
                        project_path=config.project_path,
                    )
                )
            except Exception:
                continue
    return result


def _scaffold_store(store_dir: Path, store_id: str) -> None:
    """Write attractor store files into *store_dir* (must already exist)."""
    write_store_manifest(store_dir, store_id)
    (store_dir / "issues").mkdir(exist_ok=True)
    (store_dir / "comments").mkdir(exist_ok=True)
    if not (store_dir / "meta.json").exists():
        (store_dir / "meta.json").write_text(
            json.dumps({"next_issue_id": 1, "next_comment_id": 1}, indent=2) + "\n"
        )
    if not (store_dir / "labels.json").exists():
        (store_dir / "labels.json").write_text("[]\n")


def _build_project_info(
    config: ProjectConfig, project_dir: Path, store_dir: Path
) -> ProjectInfo:
    return ProjectInfo(
        name=config.name,
        path=str(project_dir),
        issues_path=str(store_dir),
        store_id=config.store_id,
        store=config.store,
        project_path=config.project_path,
    )


def _get_github_token(settings: Settings) -> str:
    """Read stored PAT or raise 401."""
    from .github_auth import get_github_token

    token = get_github_token(settings)
    if token is None:
        raise HTTPException(
            status_code=401,
            detail="GitHub token not configured. Set a token first via POST /api/github/token.",
        )
    return token


def _authenticated_remote_url(token: str, owner: str, repo: str) -> str:
    return f"https://x-access-token:{token}@github.com/{owner}/{repo}.git"


# ---------------------------------------------------------------------------
# mode handlers
# ---------------------------------------------------------------------------


def _validate_project_path(target: Path, settings: Settings) -> None:
    """Raise if *target* cannot be used as a project directory."""
    from .filesystem import validate_path_status

    validation = validate_path_status(target, settings.data_dir)
    if validation.status == "already_registered":
        raise HTTPException(
            status_code=409,
            detail=f"Path is already tracked by project '{validation.project_name}'",
        )
    if validation.status == "not_a_directory":
        raise HTTPException(
            status_code=400, detail="Path exists but is not a directory"
        )
    if validation.status == "permission_denied":
        raise HTTPException(
            status_code=400, detail="Permission denied for the given path"
        )


def _init_internal_store(name: str, settings: Settings) -> tuple[Path, str]:
    """Create a fresh internal store under ``data/stores/{name}/``."""
    store_dir = settings.data_dir / "stores" / name
    store_id = str(uuid.uuid4())
    storage = ProjectStorage(store_dir)
    storage.init()
    write_store_manifest(store_dir, store_id)
    storage.commit("Initialize attractor store")
    return store_dir, store_id


def _create_empty(req: CreateProjectRequest, settings: Settings) -> ProjectInfo:
    """mode='empty' – create a new project (optionally at a path) with internal store."""
    project_dir = settings.data_dir / "projects" / req.name
    project_path: str | None = None

    if req.path:
        target = Path(req.path).expanduser().resolve()
        _validate_project_path(target, settings)
        target.mkdir(parents=True, exist_ok=True)
        project_path = str(target)

    store_dir, store_id = _init_internal_store(req.name, settings)

    config = ProjectConfig(
        name=req.name,
        created_at=datetime.now(timezone.utc),
        store_id=store_id,
        store=StoreConfig(path=str(store_dir.resolve())),
        project_path=project_path,
    )
    save_project_config(config, settings)
    return _build_project_info(config, project_dir, store_dir)


def _create_folder(req: CreateProjectRequest, settings: Settings) -> ProjectInfo:
    """mode='folder' – point to an existing project directory, create internal store."""
    if not req.path:
        raise HTTPException(
            status_code=400, detail="'path' is required for folder mode"
        )

    target = Path(req.path).expanduser().resolve()
    _validate_project_path(target, settings)
    project_dir = settings.data_dir / "projects" / req.name

    if not target.exists():
        raise HTTPException(
            status_code=400,
            detail="Directory does not exist. Use 'empty' mode to create a new directory.",
        )

    store_dir, store_id = _init_internal_store(req.name, settings)

    config = ProjectConfig(
        name=req.name,
        created_at=datetime.now(timezone.utc),
        store_id=store_id,
        store=StoreConfig(path=str(store_dir.resolve())),
        project_path=str(target),
    )
    save_project_config(config, settings)
    return _build_project_info(config, project_dir, store_dir)


async def _create_github(req: CreateProjectRequest, settings: Settings) -> ProjectInfo:
    """mode='github' – clone a GitHub repo and adopt/scaffold it."""
    if not req.owner or not req.repo:
        raise HTTPException(
            status_code=400,
            detail="'owner' and 'repo' are required for github mode",
        )

    token = _get_github_token(settings)
    project_dir = settings.data_dir / "projects" / req.name

    client = GitHubClient(token)
    if not await client.repo_exists(req.owner, req.repo):
        raise HTTPException(
            status_code=404,
            detail=f"Repository {req.owner}/{req.repo} not found or not accessible.",
        )

    remote_url = f"https://github.com/{req.owner}/{req.repo}.git"
    auth_url = _authenticated_remote_url(token, req.owner, req.repo)
    store_dir = settings.data_dir / "stores" / f"{req.repo}-{uuid.uuid4().hex[:8]}"

    try:
        subprocess.run(
            ["git", "clone", auth_url, str(store_dir)],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to clone repository: {exc.stderr.strip()}",
        ) from exc

    try:
        manifest_path = store_dir / ".attractor-store.json"
        if manifest_path.exists():
            manifest = read_store_manifest(store_dir)
            store_id = manifest.store_id

            # Check if another project already references this store_id
            projects_dir = settings.data_dir / "projects"
            if projects_dir.exists():
                for entry in projects_dir.iterdir():
                    cfg_path = entry / "project.json"
                    if entry.is_dir() and cfg_path.exists():
                        try:
                            existing = ProjectConfig(**json.loads(cfg_path.read_text()))
                            if existing.store_id == store_id:
                                raise HTTPException(
                                    status_code=409,
                                    detail=(
                                        f"This repository's store is already registered "
                                        f"to project '{existing.name}'"
                                    ),
                                )
                        except HTTPException:
                            raise
                        except Exception:
                            continue
        else:
            store_id = str(uuid.uuid4())
            _scaffold_store(store_dir, store_id)
            storage = ProjectStorage(store_dir)
            storage.commit("Initialize as attractor store")
            storage.push()
    except HTTPException:
        # Re-raise HTTP errors after cleanup
        if store_dir.exists():
            shutil.rmtree(store_dir)
        raise
    except Exception:
        # Clean up cloned directory on unexpected failures
        if store_dir.exists():
            shutil.rmtree(store_dir)
        raise

    github_config = GitHubStoreConfig(
        owner=req.owner,
        repo=req.repo,
        remote_url=remote_url,
    )
    config = ProjectConfig(
        name=req.name,
        created_at=datetime.now(timezone.utc),
        store_id=store_id,
        store=StoreConfig(path=str(store_dir.resolve()), github=github_config),
    )
    save_project_config(config, settings)
    return _build_project_info(config, project_dir, store_dir)


@router.post("", status_code=201)
async def create_project(
    req: CreateProjectRequest, settings: Settings = Depends(get_settings)
) -> ProjectInfo:
    """Create a new project with a separate git-backed store."""
    project_dir = settings.data_dir / "projects" / req.name
    if project_dir.exists():
        raise HTTPException(status_code=409, detail="Project already exists")

    if req.mode == "github":
        info = await _create_github(req, settings)
    elif req.mode == "folder":
        info = _create_folder(req, settings)
    else:
        info = _create_empty(req, settings)

    # Track in recent projects
    from .config import _update_recent_projects

    _update_recent_projects(settings.data_dir, req.name)

    return info


@router.get("/{name}")
def get_project(name: str, settings: Settings = Depends(get_settings)) -> ProjectInfo:
    """Return basic info for a single project."""
    config = load_project_config(name, settings)
    project_dir = settings.data_dir / "projects" / name

    # Track in recent projects
    from .config import _update_recent_projects

    _update_recent_projects(settings.data_dir, name)

    return ProjectInfo(
        name=config.name,
        path=str(project_dir),
        issues_path=config.store.path,
        store_id=config.store_id,
        store=config.store,
        project_path=config.project_path,
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
