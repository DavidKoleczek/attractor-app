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


## Creating Projects

The project picker offers three ways to create a project:

- **Open Folder** -- Point to an existing local directory (your code project). A backing issue store is created internally.
- **Clone from GitHub** -- Clone a GitHub repository as the backing issue store. Requires a GitHub Personal Access Token (see below).
- **New Empty Project** -- Create a project by name, optionally specifying a directory to create on disk.

In all cases the issue store is managed transparently under `data_dir/stores/{name}/`. The path you choose (if any) is the project directory, not the store location.

## GitHub Integration

Each project's issues data lives in a **store** -- a local git repo under `data_dir/stores/{name}/`. By default stores are local-only. You can back a store with a GitHub repository for sync and collaboration, either at project creation time (Clone from GitHub) or afterwards from project settings.

### Setup

1. From the project picker, follow the banner link to create a [fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new) with `Contents: read & write` and `Metadata: read` permissions. Add `Administration: read & write` if you also want to create repos from the app.
2. Paste the token into the banner or into **Settings > GitHub Authentication** on any project.

### Connecting an Existing Project

1. Open a project and click the gear icon to go to **Settings**.
2. Under **Store Configuration**, click **Connect to GitHub** and either connect to an existing repo or create a new one.

Once connected, the project picker shows the linked GitHub repo and the settings page offers a **Sync Now** button for manual pull/push.

## Architecture

**Backend** -- FastAPI (Python), git-backed JSON file storage. Project metadata lives in `data_dir/projects/{name}/project.json`; issues data lives in a separate store directory at `data_dir/stores/{name}/`, which is a local git repo. Stores can optionally be backed by a GitHub repository for sync and collaboration.

- [issues_server/src/issues_server/main.py](issues_server/src/issues_server/main.py) -- App entry point, routing, static serving, legacy migration
- [issues_server/src/issues_server/storage.py](issues_server/src/issues_server/storage.py) -- Git-backed JSON storage
- [issues_server/src/issues_server/models.py](issues_server/src/issues_server/models.py) -- Pydantic data models
- [issues_server/src/issues_server/amplifier.py](issues_server/src/issues_server/amplifier.py) -- Amplifier subprocess lifecycle
- [issues_server/src/issues_server/github_client.py](issues_server/src/issues_server/github_client.py) -- GitHub API client for repo operations
- [issues_server/src/issues_server/routes/](issues_server/src/issues_server/routes/) -- API endpoints (projects, issues, comments, labels, amplifier, store, github-auth, config, filesystem)

**Frontend** -- React + TypeScript + Tailwind v4 + shadcn/ui, built with Vite.

- [app/src/pages/ProjectPicker.tsx](app/src/pages/ProjectPicker.tsx) -- Project selection
- [app/src/pages/IssuesView.tsx](app/src/pages/IssuesView.tsx) -- Issue list with filters and pagination
- [app/src/pages/IssueDetail.tsx](app/src/pages/IssueDetail.tsx) -- Issue detail with comments, labels, and Amplifier controls
- [app/src/pages/ProjectSettings.tsx](app/src/pages/ProjectSettings.tsx) -- Project settings (store configuration, GitHub auth)
- [app/src/api.ts](app/src/api.ts) -- API client
- [app/src/ws.ts](app/src/ws.ts) -- WebSocket client for real-time updates


# Todos

- Server should have a production mode that will serve the build frontend
- Containerization
- Basic auth
