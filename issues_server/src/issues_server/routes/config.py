"""App-level configuration routes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends

from ..config import Settings
from ..deps import get_settings
from ..models import AppConfig

router = APIRouter(prefix="/config", tags=["config"])

_DEFAULTS = AppConfig()


def _config_path(data_dir: Path) -> Path:
    return data_dir / "app-config.json"


def _read_config(data_dir: Path) -> AppConfig:
    path = _config_path(data_dir)
    if not path.exists():
        return AppConfig()
    data = json.loads(path.read_text())
    return AppConfig(**data)


def _write_config(data_dir: Path, config: AppConfig) -> None:
    path = _config_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config.model_dump(mode="json"), indent=2) + "\n")


def _update_recent_projects(data_dir: Path, project_name: str) -> None:
    """Push *project_name* to the front of the recent-projects list."""
    config = _read_config(data_dir)
    if project_name in config.recent_projects:
        config.recent_projects.remove(project_name)
    config.recent_projects.insert(0, project_name)
    config.recent_projects = config.recent_projects[:20]
    _write_config(data_dir, config)


@router.get("")
def get_config(settings: Settings = Depends(get_settings)) -> AppConfig:
    """Return the current app configuration (defaults if file missing)."""
    return _read_config(settings.data_dir)


@router.patch("")
def patch_config(
    body: dict[str, Any], settings: Settings = Depends(get_settings)
) -> AppConfig:
    """Partially update app configuration fields."""
    config = _read_config(settings.data_dir)
    updated = config.model_dump()
    updated.update(body)
    config = AppConfig(**updated)
    _write_config(settings.data_dir, config)
    return config
