"""Comment endpoints for the issues server API."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response

from ..deps import get_ws_manager
from ..models import (
    Comment,
    CreateCommentRequest,
    ListResponse,
    SimpleUser,
    UpdateCommentRequest,
)
from ..storage import ProjectStorage
from ..ws import WebSocketManager
from .projects import get_project_storage

router = APIRouter(tags=["comments"])


# ---------------------------------------------------------------------------
# Issue-scoped comment endpoints
# ---------------------------------------------------------------------------


@router.get("/projects/{name}/issues/{number}/comments")
async def list_comments(
    number: int,
    page: int = 1,
    per_page: int = 30,
    storage: ProjectStorage = Depends(get_project_storage),
) -> ListResponse[Comment]:
    """List comments for an issue."""
    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")

    return storage.list_comments(number, page, per_page)


@router.post("/projects/{name}/issues/{number}/comments", status_code=201)
async def create_comment(
    name: str,
    number: int,
    request: CreateCommentRequest,
    storage: ProjectStorage = Depends(get_project_storage),
    ws_manager: WebSocketManager = Depends(get_ws_manager),
) -> Comment:
    """Create a comment on an issue."""
    storage.sync()

    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")

    comment_id = storage.next_comment_id()
    now = datetime.now(timezone.utc)

    comment = Comment(
        id=comment_id,
        body=request.body,
        user=SimpleUser(
            login="local-user",
            id=1,
            avatar_url="",
            user_type="User",
        ),
        created_at=now,
        updated_at=now,
        author_association="OWNER",
    )

    storage.write_comment(number, comment)

    issue.comments += 1
    storage.write_issue(issue)

    storage.commit(f"Add comment #{comment_id} on issue #{number}")
    storage.push()

    await ws_manager.broadcast(
        "comment:created",
        {
            "project": name,
            "issueNumber": number,
            "comment": comment.model_dump(mode="json"),
        },
    )

    return comment


# ---------------------------------------------------------------------------
# Project-scoped comment endpoints (scan all issues)
# ---------------------------------------------------------------------------


@router.get("/projects/{name}/comments/{comment_id}")
async def get_comment(
    comment_id: int,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Comment:
    """Get a comment by ID, scanning all issues."""
    result = storage.find_comment(comment_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Comment #{comment_id} not found")

    _issue_number, comment = result
    return comment


@router.patch("/projects/{name}/comments/{comment_id}")
async def update_comment(
    comment_id: int,
    request: UpdateCommentRequest,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Comment:
    """Update a comment by ID."""
    storage.sync()

    result = storage.find_comment(comment_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Comment #{comment_id} not found")

    issue_number, comment = result

    comment.body = request.body
    comment.updated_at = datetime.now(timezone.utc)

    storage.write_comment(issue_number, comment)
    storage.commit(f"Update comment #{comment_id}")
    storage.push()

    return comment


@router.delete("/projects/{name}/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: int,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Response:
    """Delete a comment by ID."""
    storage.sync()

    result = storage.find_comment(comment_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Comment #{comment_id} not found")

    issue_number, _comment = result

    storage.delete_comment(issue_number, comment_id)

    issue = storage.read_issue(issue_number)
    if issue is not None:
        issue.comments = max(0, issue.comments - 1)
        storage.write_issue(issue)

    storage.commit(f"Delete comment #{comment_id}")
    storage.push()

    return Response(status_code=204)
