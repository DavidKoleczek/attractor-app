"""Filesystem validation routes."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from ..config import Settings
from ..deps import get_settings
from ..models import PathValidationResponse

router = APIRouter(prefix="/filesystem", tags=["filesystem"])


def validate_path_status(target: Path, data_dir: Path) -> PathValidationResponse:
    """Validate a filesystem path for use as a project directory.

    Checks whether the path is usable and whether any existing project
    already points to it via ``project_path``.
    """
    suggested_name = target.name or None

    # Permission / existence checks
    try:
        if not target.exists():
            return PathValidationResponse(
                path=str(target),
                status="not_found",
                suggested_name=suggested_name,
            )
    except PermissionError:
        return PathValidationResponse(
            path=str(target),
            status="permission_denied",
            suggested_name=suggested_name,
        )

    if not target.is_dir():
        return PathValidationResponse(
            path=str(target),
            status="not_a_directory",
            suggested_name=suggested_name,
        )

    try:
        contents = list(target.iterdir())
    except PermissionError:
        return PathValidationResponse(
            path=str(target),
            status="permission_denied",
            suggested_name=suggested_name,
        )

    # Check if any existing project already references this directory
    projects_dir = data_dir / "projects"
    if projects_dir.exists():
        target_str = str(target)
        for entry in projects_dir.iterdir():
            config_path = entry / "project.json"
            if entry.is_dir() and config_path.exists():
                try:
                    project_data = json.loads(config_path.read_text())
                    if project_data.get("project_path") == target_str:
                        return PathValidationResponse(
                            path=str(target),
                            status="already_registered",
                            project_name=project_data.get("name"),
                            suggested_name=suggested_name,
                        )
                except (json.JSONDecodeError, OSError):
                    continue

    if not contents:
        return PathValidationResponse(
            path=str(target),
            status="empty",
            suggested_name=suggested_name,
        )

    # Check for git repo
    if (target / ".git").is_dir():
        return PathValidationResponse(
            path=str(target),
            status="git_repo",
            suggested_name=suggested_name,
        )

    return PathValidationResponse(
        path=str(target),
        status="has_content",
        suggested_name=suggested_name,
    )


@router.get("/validate-path")
def validate_path(
    path: str = Query(...),
    settings: Settings = Depends(get_settings),
) -> PathValidationResponse:
    """Validate a filesystem path for use as a project directory."""
    target = Path(path).expanduser().resolve()
    return validate_path_status(target, settings.data_dir)
