Attractor App is an app aimed at code-free creation of complex apps such as at the complexity of Microsoft Word.

# General Instructions

- DO NOT make any commits or pushes to any repos without the user's explicit permission.
- Before commit and pushing, make sure under all circumstances that no secrets or private information is being committed.
- Shortcuts are not appropriate. When in doubt, you must work with the user for guidance.
- Anything is possible. Do not blame external factors after something doesn't work on the first try. Instead, investigate and test assumptions through debugging through first principles.
- Keep the README up to date with any changes to the app's functionality, features, or usage instructions. Although, keep it short and concise.
- Make sure any comments in code are necessary. A necessary comment captures intent that cannot be encoded in names, types, or structure. Comments should be reserved for the "why", only used to record rationale, trade-offs, links to specs/papers, or non-obvious domain insights. They should add signal that code cannot.
- When writing documentation
  - Keep it very concise
  - No emojis or em dashes.
  - Documentation should be written exactly like it is for production-grade, polished, open-source applications.
- Make sure to update the README.md with any relevant changes, but maintaining the existing format and conciseness.

# Architecture

Two services, one frontend:

- **issues_server/** -- FastAPI backend. Git-backed JSON file storage. Manages projects, issues, comments, labels, and Amplifier sessions. Run with `uv run fastapi dev src/issues_server/main.py`.
- **app/** -- React + TypeScript + Tailwind v4 + shadcn/ui SPA. Communicates with the backend via REST (`/api/...`) and WebSocket (`/ws`). Run with `pnpm dev` (Vite proxies API calls to the backend).
- **Builder Service** -- not yet implemented. Separate FastAPI service that receives NL specs from the issues server and runs the Attractor pipeline (NL spec -> Graphviz dot -> Attractor runner).

# Key Files

@README.md
