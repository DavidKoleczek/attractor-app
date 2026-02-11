"""FastAPI dependency injection helpers.

Provides cached singletons for application-wide services.
Storage and Amplifier dependencies will be added in later modules.
"""

from functools import lru_cache

from .amplifier import AmplifierManager
from .config import Settings
from .ws import WebSocketManager


@lru_cache
def get_settings() -> Settings:
    """Return the cached application settings singleton."""
    return Settings()


# Module-level singleton -- one manager shared across the application.
_ws_manager = WebSocketManager()


def get_ws_manager() -> WebSocketManager:
    """Return the shared WebSocket manager instance."""
    return _ws_manager


# Module-level singleton -- one manager shared across the application.
_amplifier_manager = AmplifierManager()


def get_amplifier_manager() -> AmplifierManager:
    """Return the shared Amplifier session manager instance."""
    return _amplifier_manager
