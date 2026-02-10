# Attractor Issues

Attractor App is an app aimed at code-free creation of complex apps.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v10+
- [Rust](https://rustup.rs/) (stable toolchain)
- Tauri v2 system dependencies -- see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- A GitHub account

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

## How It Works

**Backend (Rust)**

- [src-tauri/src/storage.rs](src-tauri/src/storage.rs) -- Data storage (git-backed write-ahead log)
- [src-tauri/src/models.rs](src-tauri/src/models.rs) -- Data models (GitHub Issues API shapes)
- [src-tauri/src/github.rs](src-tauri/src/github.rs) -- GitHub API client (repo listing, creation, auth)
- [src-tauri/src/commands.rs](src-tauri/src/commands.rs) -- Tauri commands (full backend API surface)
- [src-tauri/src/state.rs](src-tauri/src/state.rs), [src-tauri/src/lib.rs](src-tauri/src/lib.rs) -- App state and token management

**Frontend (React + TypeScript)**

- [src/api.ts](src/api.ts) -- Frontend API wrapper
- [src/types.ts](src/types.ts) -- TypeScript types
- [src/components/AuthGate.tsx](src/components/AuthGate.tsx) -- Authentication gate
- [src/pages/ProjectPicker.tsx](src/pages/ProjectPicker.tsx) -- Project Picker screen
- [src/pages/IssuesView.tsx](src/pages/IssuesView.tsx) -- Issues View screen
- [src/pages/IssueDetail.tsx](src/pages/IssueDetail.tsx) -- Issue Detail screen
