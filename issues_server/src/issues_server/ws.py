"""WebSocket manager for broadcasting real-time events to connected clients."""

import json

from fastapi import WebSocket


class WebSocketManager:
    """Maintains a set of active WebSocket connections and broadcasts events."""

    def __init__(self) -> None:
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        """Accept and register a new WebSocket connection."""
        await ws.accept()
        self.connections.append(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        """Remove a WebSocket from the active connections list."""
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, event: str, data: dict) -> None:
        """Send a JSON message to every connected client.

        Clients that fail to receive the message are silently
        disconnected so they do not block future broadcasts.
        """
        message = json.dumps({"event": event, "data": data})
        disconnected: list[WebSocket] = []
        for ws in self.connections:
            try:
                await ws.send_text(message)
            except Exception:  # noqa: BLE001
                disconnected.append(ws)
        for ws in disconnected:
            await self.disconnect(ws)
