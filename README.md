# Attractor Issues

Attractor App is an app aimed at code-free creation of complex apps.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v10+
- [Rust](https://rustup.rs/) (stable toolchain)
- Tauri v2 system dependencies -- see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- A GitHub account
- [Amplifier CLI](https://github.com/microsoft/amplifier)

## Getting Started

```bash
# Install frontend dependencies
pnpm install

# Run in development mode (compiles Rust + starts Vite dev server)
pnpm tauri dev

# Build for production
pnpm tauri build
```

On first launch the app will prompt you for a GitHub Personal Access Token (PAT).

## GitHub Token Setup

The app requires a **fine-grained personal access token** to read/write data in your GitHub repos.

1. Go to https://github.com/settings/personal-access-tokens/new
2. Set a name (e.g. `attractor-issues`) and expiration
3. Under **Repository access**, select "All repositories" or just your `attractor-*` repos
4. Set these **repository permissions**:

**Always required:**

| Permission | Access | Why |
|------------|--------|-----|
| Contents | Read and write | Push/pull project data via git |
| Metadata | Read-only | List repos, get repo info (granted automatically) |

**Only if you create repos from the app:**

| Permission | Access | Why |
|------------|--------|-----|
| Administration | Read and write | GitHub's API requires this for `POST /user/repos` |

> If you prefer to create repos on github.com and only open them in the app, you can skip Administration entirely. 
If the app needs a repo it can't create, it will tell you the exact name and link you to GitHub to create it. You can also choose "Only select repositories" under Repository access to limit the token's scope.

5. Generate and copy the token
6. Paste it into the app on first launch

The token is stored in your OS keychain via Tauri's secure store plugin. It never touches the browser/webview.

## Amplifier Integration

The app can hand off issues to [Amplifier](https://github.com/microsoft/amplifier) for AI-assisted resolution. From the Issue Detail sidebar, click **Run Amplifier** to spawn a session that reads the issue, works on it in your project directory, and posts a summary comment when finished.

### Setup

1. Install the Amplifier CLI: `uv tool install git+https://github.com/microsoft/amplifier`
2. Set `ANTHROPIC_API_KEY` in your environment (the default provider is Anthropic).
3. Ensure `amplifier` is on your `PATH`.

On first run the app creates `.amplifier/settings.local.yaml` in your project directory if one does not already exist. This file configures the provider. To use a different provider or model, edit it directly.

### How It Works

1. You click **Run Amplifier** on an issue.
2. The backend builds a prompt from the issue title and body, then spawns `amplifier run --output-format json "<prompt>"` as a child process in the project directory.
3. The sidebar shows a spinner while the session runs. You can cancel at any time.
4. When the session finishes, the app writes the result as a comment on the issue (success summary or error message), commits, and pushes.
5. The comment list refreshes automatically via Tauri events (`amplifier:started`, `amplifier:completed`, `amplifier:failed`).

Multiple issues can have concurrent Amplifier sessions. Session state is in-memory only; completed results are persisted as issue comments.

## How It Works

**Backend (Rust)**

- [src-tauri/src/storage.rs](src-tauri/src/storage.rs) -- Data storage (git-backed write-ahead log)
- [src-tauri/src/models.rs](src-tauri/src/models.rs) -- Data models (GitHub Issues API shapes)
- [src-tauri/src/github.rs](src-tauri/src/github.rs) -- GitHub API client (repo listing, creation, auth)
- [src-tauri/src/commands.rs](src-tauri/src/commands.rs) -- Tauri commands (full backend API surface)
- [src-tauri/src/amplifier.rs](src-tauri/src/amplifier.rs) -- Amplifier subprocess lifecycle (spawn, monitor, cancel)
- [src-tauri/src/state.rs](src-tauri/src/state.rs), [src-tauri/src/lib.rs](src-tauri/src/lib.rs) -- App state and token management

**Frontend (React + TypeScript)**

- [src/api.ts](src/api.ts) -- Frontend API wrapper
- [src/types.ts](src/types.ts) -- TypeScript types
- [src/components/AuthGate.tsx](src/components/AuthGate.tsx) -- Authentication gate
- [src/pages/ProjectPicker.tsx](src/pages/ProjectPicker.tsx) -- Project Picker screen
- [src/pages/IssuesView.tsx](src/pages/IssuesView.tsx) -- Issues View screen
- [src/pages/IssueDetail.tsx](src/pages/IssueDetail.tsx) -- Issue Detail screen (includes Amplifier session UI)

# TODOs

- Testing/Validation that can be done in a container and easily torn up and down to create many things. Current challenge is we need a GitHub repo each time.
- Integrate an actual implementation of Attractor to improve software creaton capabilities.
- Figure out UX
  - Initial project state. Right now you need to make an issue. Ideally, you would provide something like a spec
  - When you create an issue Amplifier immediately starts working on it and ends in one of a few (loosely defined) states (follow-up, delegate to implementing, etc). We give it the Issues API so its flexible
  - Push back a way to UX a way to run the app. For example, Amplifier outputs a structured command that gets parsed.
- Other issues to figure out:
  - Dealing with concurrency, multiple issues, multiple comments, etc.
