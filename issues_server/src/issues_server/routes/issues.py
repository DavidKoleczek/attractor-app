"""Issue CRUD routes for a single project."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import get_ws_manager
from ..models import (
    CreateIssueRequest,
    Issue,
    IssueFilters,
    ListResponse,
    SimpleUser,
    UpdateIssueRequest,
)
from ..storage import ProjectStorage
from ..ws import WebSocketManager
from .projects import get_project_storage

router = APIRouter(prefix="/projects/{name}/issues", tags=["issues"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_labels(storage: ProjectStorage, label_names: list[str]) -> list:
    """Match requested label names against the project's labels.json.

    Unknown names are silently skipped.
    """
    all_labels = storage.read_labels()
    by_name = {label.name: label for label in all_labels}
    return [by_name[n] for n in label_names if n in by_name]


def _make_user_stubs(logins: list[str]) -> list[SimpleUser]:
    """Create minimal SimpleUser objects for a list of login names."""
    return [
        SimpleUser(login=login, id=0, avatar_url="", user_type="User")
        for login in logins
    ]


LOCAL_USER = SimpleUser(login="local-user", id=1, avatar_url="", user_type="User")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=ListResponse[Issue])
def list_issues(
    filters: IssueFilters = Depends(),
    storage: ProjectStorage = Depends(get_project_storage),
) -> ListResponse[Issue]:
    """List issues for a project with optional filtering and pagination."""
    return storage.list_issues(filters)


@router.post("", response_model=Issue, status_code=status.HTTP_201_CREATED)
async def create_issue(
    name: str,
    body: CreateIssueRequest,
    storage: ProjectStorage = Depends(get_project_storage),
    ws: WebSocketManager = Depends(get_ws_manager),
) -> Issue:
    """Create a new issue in the project."""
    storage.sync()

    issue_id = storage.next_issue_id()
    now = datetime.now(timezone.utc)

    labels = _resolve_labels(storage, body.labels)
    assignees = _make_user_stubs(body.assignees)

    issue = Issue(
        id=issue_id,
        number=issue_id,
        title=body.title,
        body=body.body,
        labels=labels,
        assignees=assignees,
        user=LOCAL_USER,
        created_at=now,
        updated_at=now,
    )

    storage.write_issue(issue)
    storage.commit(f"Create issue #{issue.number}: {issue.title}")
    storage.push()

    await ws.broadcast(
        "issue:created",
        {"project": name, "issue": issue.model_dump(mode="json")},
    )
    return issue


@router.get("/{number}", response_model=Issue)
def get_issue(
    number: int,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Issue:
    """Return a single issue by number."""
    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")
    return issue


@router.patch("/{number}", response_model=Issue)
async def update_issue(
    name: str,
    number: int,
    body: UpdateIssueRequest,
    storage: ProjectStorage = Depends(get_project_storage),
    ws: WebSocketManager = Depends(get_ws_manager),
) -> Issue:
    """Update an existing issue (partial update)."""
    storage.sync()

    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")

    now = datetime.now(timezone.utc)

    if body.title is not None:
        issue.title = body.title
    if body.body is not None:
        issue.body = body.body

    # State transitions
    if body.state is not None and body.state != issue.state:
        issue.state = body.state
        if body.state == "closed":
            issue.closed_at = now
            issue.closed_by = SimpleUser(
                login="local-user", id=1, avatar_url="", user_type="User"
            )
            issue.state_reason = body.state_reason or "completed"
        elif body.state == "open":
            issue.closed_at = None
            issue.closed_by = None
            issue.state_reason = None

    # Label resolution
    if body.labels is not None:
        issue.labels = _resolve_labels(storage, body.labels)

    # Assignee resolution
    if body.assignees is not None:
        issue.assignees = _make_user_stubs(body.assignees)

    issue.updated_at = now

    storage.write_issue(issue)
    storage.commit(f"Update issue #{number}")
    storage.push()

    await ws.broadcast(
        "issue:updated",
        {"project": name, "issue": issue.model_dump(mode="json")},
    )
    return issue
