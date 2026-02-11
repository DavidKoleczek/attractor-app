"""GitHub authentication routes for PAT management."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from issues_server.config import Settings
from issues_server.deps import get_settings
from issues_server.github_client import GitHubClient

router = APIRouter(prefix="/github", tags=["github"])

PAT_CREATE_URL = (
    "https://github.com/settings/personal-access-tokens/new"
    "?name=attractor-issues"
    "&repository_permissions=contents:write,metadata:read,administration:write"
)

REQUIRED_PERMISSIONS = [
    "Contents: read & write",
    "Metadata: read (auto-granted)",
    "Administration: read & write (only for creating new repos)",
]


def _token_path(settings: Settings):
    return settings.data_dir / "github-token.json"


def _read_token(settings: Settings) -> dict | None:
    path = _token_path(settings)
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _write_token(settings: Settings, data: dict) -> None:
    path = _token_path(settings)
    path.write_text(json.dumps(data, indent=2) + "\n")


def _delete_token(settings: Settings) -> None:
    path = _token_path(settings)
    if path.exists():
        path.unlink()


def get_github_token(settings: Settings) -> str | None:
    """Get the stored GitHub PAT, or None if not configured."""
    data = _read_token(settings)
    if data is None:
        return None
    return data.get("token")


class GitHubStatusResponse(BaseModel):
    configured: bool
    user: str | None = None
    validated_at: str | None = None


class SetTokenRequest(BaseModel):
    token: str


class SetTokenResponse(BaseModel):
    user: str
    validated_at: str


class PatUrlResponse(BaseModel):
    url: str
    required_permissions: list[str]


@router.get("/status")
async def github_status(
    settings: Settings = Depends(get_settings),
) -> GitHubStatusResponse:
    """Check if a GitHub PAT is configured and valid."""
    data = _read_token(settings)
    if data is None:
        return GitHubStatusResponse(configured=False)
    return GitHubStatusResponse(
        configured=True,
        user=data.get("user"),
        validated_at=data.get("validated_at"),
    )


@router.post("/token")
async def set_token(
    req: SetTokenRequest, settings: Settings = Depends(get_settings)
) -> SetTokenResponse:
    """Set or update the GitHub PAT. Validates via GitHub API."""
    client = GitHubClient(req.token)
    try:
        user_info = await client.get_authenticated_user()
    except Exception as exc:
        raise HTTPException(
            status_code=401,
            detail=f"Token validation failed: {exc}",
        ) from exc

    validated_at = datetime.now(timezone.utc).isoformat()
    _write_token(
        settings,
        {
            "token": req.token,
            "user": user_info["login"],
            "validated_at": validated_at,
        },
    )
    return SetTokenResponse(user=user_info["login"], validated_at=validated_at)


@router.delete("/token", status_code=204)
async def remove_token(settings: Settings = Depends(get_settings)) -> None:
    """Remove the stored GitHub PAT."""
    _delete_token(settings)


@router.get("/pat-url")
async def get_pat_url() -> PatUrlResponse:
    """Return a URL to create a new GitHub PAT with the correct permissions."""
    return PatUrlResponse(
        url=PAT_CREATE_URL,
        required_permissions=REQUIRED_PERMISSIONS,
    )
