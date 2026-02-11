# Frontend

Single-page application for issue tracking, built with React and TypeScript.

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) v10+

## Getting Started

```bash
cd app/
pnpm install
pnpm dev
```

The dev server starts at `http://localhost:5173` and proxies `/api` and `/ws` to `http://localhost:8000` (the issues server).

For production:

```bash
pnpm build
```

Output goes to `dist/`, which the issues server can serve statically via `ATTRACTOR_FRONTEND_DIR`.

## How It Works

See the [spec](../specs/spa_spec.md) for the full design, including:

- [Routes](../specs/spa_spec.md#routes) -- ProjectPicker, IssuesView, IssueDetail
- [API client](../specs/spa_spec.md#api-client) -- Thin fetch wrapper matching the server's REST endpoints
- [WebSocket](../specs/spa_spec.md#websocket) -- Real-time updates with auto-reconnect
- [Amplifier integration](../specs/spa_spec.md#amplifier) -- Run/cancel/status controls per issue
