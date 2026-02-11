# Attractor

Code-free creation of complex apps.

## Prerequisites

- [Python](https://www.python.org/) 3.13+
- [uv](https://docs.astral.sh/uv/)
- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v10+
- [Amplifier CLI](https://github.com/microsoft/amplifier)

## Getting Started

Start the backend:

```bash
cd issues_server
uv run fastapi dev src/issues_server/main.py
```

In a second terminal, start the frontend:

```bash
cd app
pnpm install
pnpm dev
```

The app is available at `http://localhost:5173`. The Vite dev server proxies `/api` and `/ws` to the FastAPI backend on port 8000.

## Amplifier Integration

Issues can be handed off to [Amplifier](https://github.com/microsoft/amplifier) for AI-assisted resolution. From the Issue Detail sidebar, click **Run Amplifier** to spawn a session that reads the issue, works on it, and posts a summary comment when finished.

### Setup

1. Install the Amplifier CLI: `uv tool install git+https://github.com/microsoft/amplifier`
2. Set `ANTHROPIC_API_KEY` in your environment (the default provider is Anthropic).
3. Ensure `amplifier` is on your `PATH`.

On first run the server creates `.amplifier/settings.local.yaml` in the project data directory if one does not already exist.

### How It Works

1. Click **Run Amplifier** on an issue.
2. The server builds a prompt from the issue title and body, then spawns `amplifier run --output-format json "<prompt>"` as a child process.
3. The sidebar shows a spinner while the session runs. You can cancel at any time.
4. When the session finishes, the result is written as a comment on the issue, committed to the data repo.
5. The UI refreshes automatically via WebSocket events.

Multiple issues can have concurrent Amplifier sessions. Session state is in-memory; results are persisted as issue comments.

## Architecture

**Backend** -- FastAPI (Python), git-backed JSON file storage. Each project is a local git repo containing issues, comments, and labels as JSON files. GitHub backing is optional: set a remote and push.

- [issues_server/src/issues_server/main.py](issues_server/src/issues_server/main.py) -- App entry point, routing, static serving
- [issues_server/src/issues_server/storage.py](issues_server/src/issues_server/storage.py) -- Git-backed JSON storage
- [issues_server/src/issues_server/models.py](issues_server/src/issues_server/models.py) -- Pydantic data models
- [issues_server/src/issues_server/amplifier.py](issues_server/src/issues_server/amplifier.py) -- Amplifier subprocess lifecycle
- [issues_server/src/issues_server/routes/](issues_server/src/issues_server/routes/) -- API endpoints (projects, issues, comments, labels, amplifier)

**Frontend** -- React + TypeScript + Tailwind v4 + shadcn/ui, built with Vite.

- [app/src/pages/ProjectPicker.tsx](app/src/pages/ProjectPicker.tsx) -- Project selection
- [app/src/pages/IssuesView.tsx](app/src/pages/IssuesView.tsx) -- Issue list with filters and pagination
- [app/src/pages/IssueDetail.tsx](app/src/pages/IssueDetail.tsx) -- Issue detail with comments, labels, and Amplifier controls
- [app/src/api.ts](app/src/api.ts) -- API client
- [app/src/ws.ts](app/src/ws.ts) -- WebSocket client for real-time updates

## Production / Docker

```bash
cd app && pnpm build
cd ../issues_server && uv run fastapi run src/issues_server/main.py
```

FastAPI serves the built SPA from `app/dist/` and exposes the API on a single port. See [Attractor-Amplifier-Spec.md](Attractor-Amplifier-Spec.md) for the full container strategy.