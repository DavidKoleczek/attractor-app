"""Application settings loaded from environment variables."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Attractor application settings.

    All fields can be overridden via environment variables
    with the ``ATTRACTOR_`` prefix (e.g. ``ATTRACTOR_PORT=9000``).
    """

    data_dir: Path = Path("./data")
    host: str = "127.0.0.1"
    port: int = 8000
    frontend_dir: Path = Path("./frontend/dist")

    model_config = SettingsConfigDict(env_prefix="ATTRACTOR_")
