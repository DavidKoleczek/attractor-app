# Issues Server

REST API for issue tracking backed by local git repositories.

## Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/)
- Git

## Getting Started

```bash
cd issues_server/
uv sync
uv run fastapi dev src/issues_server/main.py
```

The server starts at `http://127.0.0.1:8000`. API docs are at `/docs`.

## Configuration

Environment variables (prefix `ATTRACTOR_`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ATTRACTOR_DATA_DIR` | `./data` | Root directory for project data repos |
| `ATTRACTOR_HOST` | `127.0.0.1` | Bind address |
| `ATTRACTOR_PORT` | `8000` | Bind port |
| `ATTRACTOR_FRONTEND_DIR` | `./frontend/dist` | Built SPA directory for static serving |

## How It Works

- [Data models](../specs/issues_server_spec.md#data-models) -- Pydantic models mirroring the GitHub Issues API
- [Storage](../specs/issues_server_spec.md#storage) -- Git-backed JSON file layout and write pattern
- [API endpoints](../specs/issues_server_spec.md#api-endpoints) -- Full route listing
- [Amplifier integration](../specs/issues_server_spec.md#amplifier-integration) -- Subprocess lifecycle
