"""Store configuration routes for connecting projects to GitHub."""

import json
import subprocess
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from issues_server.config import Settings
from issues_server.deps import get_settings
from issues_server.github_client import GitHubClient
from issues_server.models import GitHubStoreConfig, StoreConfig
from issues_server.routes.github_auth import get_github_token
from issues_server.routes.projects import (
    load_project_config,
    read_store_manifest,
    save_project_config,
    write_store_manifest,
)
from issues_server.storage import ProjectStorage

router = APIRouter(prefix="/projects/{name}/store", tags=["store"])


def _require_token(settings: Settings) -> str:
    """Get stored GitHub token or raise 400."""
    token = get_github_token(settings)
    if token is None:
        raise HTTPException(
            status_code=400,
            detail="GitHub token not configured. Set a token first via POST /api/github/token.",
        )
    return token


def _authenticated_remote_url(token: str, owner: str, repo: str) -> str:
    """Build a remote URL with embedded token for push/pull auth."""
    return f"https://x-access-token:{token}@github.com/{owner}/{repo}.git"


class StoreStatusResponse(BaseModel):
    store_id: str
    path: str
    github: GitHubStoreConfig | None = None


class ConnectRequest(BaseModel):
    owner: str
    repo: str


class CreateRemoteRequest(BaseModel):
    repo_name: str
    private: bool = True
    description: str = ""


class CreateRemoteForbiddenResponse(BaseModel):
    error: str = "REPO_CREATE_FORBIDDEN"
    detail: str
    create_url: str
    instructions: str


class SyncResponse(BaseModel):
    pulled: bool
    pushed: bool


@router.get("")
def get_store(
    name: str, settings: Settings = Depends(get_settings)
) -> StoreStatusResponse:
    """Get current store configuration for a project."""
    config = load_project_config(name, settings)
    return StoreStatusResponse(
        store_id=config.store_id,
        path=config.store.path,
        github=config.store.github,
    )


@router.post("/connect")
async def connect_store(
    name: str,
    req: ConnectRequest,
    settings: Settings = Depends(get_settings),
) -> StoreStatusResponse:
    """Connect a project's store to an existing GitHub repo."""
    token = _require_token(settings)
    config = load_project_config(name, settings)

    # Verify repo exists
    client = GitHubClient(token)
    if not await client.repo_exists(req.owner, req.repo):
        raise HTTPException(
            status_code=404,
            detail=f"Repository {req.owner}/{req.repo} not found or not accessible.",
        )

    # Clone the remote repo to a new store directory
    remote_url = f"https://github.com/{req.owner}/{req.repo}.git"
    auth_url = _authenticated_remote_url(token, req.owner, req.repo)
    new_store_dir = settings.data_dir / "stores" / f"{name}-{uuid.uuid4().hex[:8]}"

    try:
        subprocess.run(
            ["git", "clone", auth_url, str(new_store_dir)],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to clone repository: {exc.stderr.strip()}",
        ) from exc

    storage = ProjectStorage(new_store_dir)

    # Check if .attractor-store.json exists in cloned repo
    manifest_path = new_store_dir / ".attractor-store.json"
    if manifest_path.exists():
        # This is a known attractor store -- use its store_id
        manifest = read_store_manifest(new_store_dir)
        store_id = manifest.store_id
    else:
        # Initialize as an attractor store
        store_id = str(uuid.uuid4())
        write_store_manifest(new_store_dir, store_id)

        # Ensure the store has standard dirs
        (new_store_dir / "issues").mkdir(exist_ok=True)
        (new_store_dir / "comments").mkdir(exist_ok=True)
        if not (new_store_dir / "meta.json").exists():
            (new_store_dir / "meta.json").write_text(
                json.dumps({"next_issue_id": 1, "next_comment_id": 1}, indent=2) + "\n"
            )
        if not (new_store_dir / "labels.json").exists():
            (new_store_dir / "labels.json").write_text("[]\n")

        storage.commit("Initialize as attractor store")
        storage.push()

    # Update project config
    github_config = GitHubStoreConfig(
        owner=req.owner,
        repo=req.repo,
        remote_url=remote_url,
    )
    config.store_id = store_id
    config.store = StoreConfig(
        path=str(new_store_dir.resolve()),
        github=github_config,
    )
    save_project_config(config, settings)

    return StoreStatusResponse(
        store_id=store_id,
        path=str(new_store_dir.resolve()),
        github=github_config,
    )


@router.post("/create-remote")
async def create_remote(
    name: str,
    req: CreateRemoteRequest,
    settings: Settings = Depends(get_settings),
) -> StoreStatusResponse:
    """Create a new GitHub repo and connect the existing local store to it."""
    token = _require_token(settings)
    config = load_project_config(name, settings)
    store_path = Path(config.store.path)

    if not store_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Store directory not found at {store_path}",
        )

    # Create repo via GitHub API
    client = GitHubClient(token)
    try:
        user_info = await client.get_authenticated_user()
        repo_data = await client.create_repo(
            name=req.repo_name,
            private=req.private,
            description=req.description,
        )
    except PermissionError:
        create_url = (
            f"https://github.com/new"
            f"?name={req.repo_name}"
            f"&visibility={'private' if req.private else 'public'}"
        )
        raise HTTPException(
            status_code=403,
            detail={
                "error": "REPO_CREATE_FORBIDDEN",
                "message": "Your token doesn't have permission to create repositories.",
                "create_url": create_url,
                "instructions": "Create the repo manually on GitHub, then use 'Connect to Existing Repo'.",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create repository: {exc}",
        ) from exc

    owner = user_info["login"]
    repo_name = repo_data["name"]
    remote_url = f"https://github.com/{owner}/{repo_name}.git"
    auth_url = _authenticated_remote_url(token, owner, repo_name)

    # Add remote to existing local store
    storage = ProjectStorage(store_path)
    storage.set_remote(auth_url)

    # Push existing data to the new remote
    try:
        storage.push()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to push to new remote: {exc}",
        ) from exc

    # Update project config (store_id stays the same)
    github_config = GitHubStoreConfig(
        owner=owner,
        repo=repo_name,
        remote_url=remote_url,
    )
    config.store = StoreConfig(
        path=config.store.path,
        github=github_config,
    )
    save_project_config(config, settings)

    return StoreStatusResponse(
        store_id=config.store_id,
        path=config.store.path,
        github=github_config,
    )


@router.post("/sync")
def sync_store(name: str, settings: Settings = Depends(get_settings)) -> SyncResponse:
    """Manual pull then push for a GitHub-connected store."""
    config = load_project_config(name, settings)
    store_path = Path(config.store.path)

    if config.store.github is None:
        raise HTTPException(
            status_code=400,
            detail="Store is not connected to GitHub. Nothing to sync.",
        )

    storage = ProjectStorage(store_path)
    pulled = False
    pushed = False

    try:
        storage.sync()
        pulled = True
    except Exception:
        pass

    try:
        storage.push()
        pushed = True
    except Exception:
        pass

    return SyncResponse(pulled=pulled, pushed=pushed)
