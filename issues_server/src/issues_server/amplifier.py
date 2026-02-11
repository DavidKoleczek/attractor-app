"""Amplifier CLI subprocess manager.

Manages Amplifier CLI subprocess sessions for AI-assisted issue resolution.
Spawns `amplifier run` as a child process, captures JSON output, and writes
results back as issue comments.
"""

import asyncio
import json
import signal
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .models import ATTRACTOR_BOT, AmplifierSessionInfo, Comment, Issue
from .storage import ProjectStorage
from .ws import WebSocketManager

_DEFAULT_SETTINGS_YAML = """\
config:
  providers:
  - module: provider-anthropic
    config:
      api_key: ${ANTHROPIC_API_KEY}
      base_url: https://api.anthropic.com
      default_model: claude-opus-4-6
      enable_prompt_caching: 'true'
      priority: 1
    source: git+https://github.com/microsoft/amplifier-module-provider-anthropic@main
"""


def _extract_json(text: str) -> dict | None:
    """Extract the last valid JSON object from *text*.

    Amplifier stdout may contain ANSI escape sequences or other noise before
    the JSON payload.  We first try to parse the entire string, then scan
    backward looking for the last ``{`` that opens a valid JSON object.
    """
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    for i in range(len(text) - 1, -1, -1):
        if text[i] == "{":
            try:
                data = json.loads(text[i:])
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                continue

    return None


@dataclass
class AmplifierSession:
    """Tracks the lifetime of a single Amplifier subprocess."""

    project_name: str
    issue_number: int
    status: str  # "running", "completed", "failed"
    started_at: str
    finished_at: str | None = None
    error: str | None = None
    task: asyncio.Task | None = field(default=None, repr=False)  # type: ignore[type-arg]
    process: asyncio.subprocess.Process | None = field(default=None, repr=False)


class AmplifierManager:
    """Manage Amplifier CLI sessions across projects and issues."""

    def __init__(self) -> None:
        self.sessions: dict[str, AmplifierSession] = {}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _key(self, project_name: str, issue_number: int) -> str:
        return f"{project_name}#{issue_number}"

    @staticmethod
    def _ensure_settings(project_path: Path) -> None:
        """Write default Amplifier settings if none exist."""
        settings_path = project_path / ".amplifier" / "settings.local.yaml"
        if settings_path.exists():
            return
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        settings_path.write_text(_DEFAULT_SETTINGS_YAML)

    @staticmethod
    def _build_prompt(issue: Issue) -> str:
        prompt = f"Issue #{issue.number}: {issue.title}"
        if issue.body:
            prompt += f"\n\n{issue.body}"
        return prompt

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def run(
        self,
        project_name: str,
        issue_number: int,
        issue: Issue,
        project_storage: ProjectStorage,
        ws_manager: WebSocketManager,
        project_dir: Path | None = None,
    ) -> None:
        """Launch an Amplifier session for the given issue.

        Args:
            project_dir: Project metadata directory used for CWD and
                ``.amplifier/`` settings.  Falls back to the store path
                when *None* (legacy behaviour).

        Raises:
            ValueError: If a session is already running for this issue.
        """
        key = self._key(project_name, issue_number)

        existing = self.sessions.get(key)
        if existing is not None and existing.status == "running":
            raise ValueError(
                f"Amplifier session already running for {project_name} issue #{issue_number}"
            )

        cwd = project_dir or project_storage.path
        self._ensure_settings(cwd)

        prompt = self._build_prompt(issue)

        process = await asyncio.create_subprocess_exec(
            "amplifier",
            "run",
            "--output-format",
            "json",
            prompt,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        session = AmplifierSession(
            project_name=project_name,
            issue_number=issue_number,
            status="running",
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        session.process = process
        self.sessions[key] = session

        await ws_manager.broadcast(
            "amplifier:started",
            {"project": project_name, "issueNumber": issue_number},
        )

        task = asyncio.create_task(self._wait(key, project_storage, ws_manager))
        session.task = task

    async def _wait(
        self,
        key: str,
        project_storage: ProjectStorage,
        ws_manager: WebSocketManager,
    ) -> None:
        """Wait for the subprocess to finish and record the result."""
        session = self.sessions[key]
        assert session.process is not None

        try:
            stdout_bytes, stderr_bytes = await session.process.communicate()

            # -- Interpret result -----------------------------------------------
            comment_body: str | None = None
            error_msg: str | None = None

            parsed = _extract_json(stdout_bytes.decode())

            if parsed is not None:
                if parsed.get("status") == "success":
                    comment_body = parsed.get("response", "")
                else:
                    error_msg = parsed.get("error", "Amplifier session failed")
            else:
                stderr_text = stderr_bytes.decode()
                tail = "\n".join(stderr_text.splitlines()[-10:])
                error_msg = (
                    tail or f"Process exited with code {session.process.returncode}"
                )

            # -- Persist as comment ---------------------------------------------
            project_storage.sync()
            next_id = project_storage.next_comment_id()
            now = datetime.now(timezone.utc)

            body = comment_body if comment_body is not None else (error_msg or "")

            comment = Comment(
                id=next_id,
                body=body,
                user=ATTRACTOR_BOT,
                author_association="BOT",
                created_at=now,
                updated_at=now,
            )

            project_storage.write_comment(session.issue_number, comment)

            issue = project_storage.read_issue(session.issue_number)
            if issue is not None:
                issue.comments += 1
                project_storage.write_issue(issue)

            project_storage.commit(
                f"amplifier: result for issue #{session.issue_number}"
            )
            project_storage.push()

            # -- Update session state -------------------------------------------
            session.finished_at = datetime.now(timezone.utc).isoformat()

            if comment_body is not None:
                session.status = "completed"
                await ws_manager.broadcast(
                    "amplifier:completed",
                    {
                        "project": session.project_name,
                        "issueNumber": session.issue_number,
                        "commentId": comment.id,
                    },
                )
            else:
                session.status = "failed"
                session.error = error_msg
                await ws_manager.broadcast(
                    "amplifier:failed",
                    {
                        "project": session.project_name,
                        "issueNumber": session.issue_number,
                        "error": error_msg,
                    },
                )

        except Exception as exc:
            session.status = "failed"
            session.error = str(exc)
            session.finished_at = datetime.now(timezone.utc).isoformat()

            await ws_manager.broadcast(
                "amplifier:failed",
                {
                    "project": session.project_name,
                    "issueNumber": session.issue_number,
                    "error": str(exc),
                },
            )

    def get_status(
        self, project_name: str, issue_number: int
    ) -> AmplifierSessionInfo | None:
        """Return session info or ``None`` if no session exists."""
        session = self.sessions.get(self._key(project_name, issue_number))
        if session is None:
            return None
        return AmplifierSessionInfo(
            issue_number=session.issue_number,
            status=session.status,
            started_at=session.started_at,
            finished_at=session.finished_at,
            error=session.error,
        )

    def cancel(self, project_name: str, issue_number: int) -> bool:
        """Send SIGTERM to a running session.  Returns True if signal sent."""
        session = self.sessions.get(self._key(project_name, issue_number))
        if session is None or session.status != "running" or session.process is None:
            return False
        session.process.send_signal(signal.SIGTERM)
        return True

    def list_sessions(self) -> list[AmplifierSessionInfo]:
        """Return info for every tracked session."""
        return [
            AmplifierSessionInfo(
                issue_number=s.issue_number,
                status=s.status,
                started_at=s.started_at,
                finished_at=s.finished_at,
                error=s.error,
            )
            for s in self.sessions.values()
        ]
