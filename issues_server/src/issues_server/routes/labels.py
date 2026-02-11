"""Label endpoints for the issues server API."""

from fastapi import APIRouter, Body, Depends, HTTPException, Response

from ..models import (
    CreateLabelRequest,
    Label,
    UpdateLabelRequest,
)
from ..storage import ProjectStorage
from .projects import get_project_storage

router = APIRouter(tags=["labels"])


# ---------------------------------------------------------------------------
# Repo-level label endpoints
# ---------------------------------------------------------------------------


@router.get("/projects/{name}/labels")
async def list_labels(
    storage: ProjectStorage = Depends(get_project_storage),
) -> list[Label]:
    """List all labels for a project."""
    return storage.read_labels()


@router.post("/projects/{name}/labels", status_code=201)
async def create_label(
    request: CreateLabelRequest,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Label:
    """Create a new label."""
    storage.sync()

    labels = storage.read_labels()

    for existing in labels:
        if existing.name == request.name:
            raise HTTPException(
                status_code=409,
                detail=f"Label '{request.name}' already exists",
            )

    new_id = max((label.id for label in labels), default=0) + 1

    label = Label(
        id=new_id,
        name=request.name,
        color=request.color,
        description=request.description,
        is_default=False,
    )

    labels.append(label)
    storage.write_labels(labels)
    storage.commit(f"Create label '{label.name}'")
    storage.push()

    return label


@router.get("/projects/{name}/labels/{label_name}")
async def get_label(
    label_name: str,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Label:
    """Get a label by name."""
    labels = storage.read_labels()
    for label in labels:
        if label.name == label_name:
            return label
    raise HTTPException(status_code=404, detail=f"Label '{label_name}' not found")


@router.patch("/projects/{name}/labels/{label_name}")
async def update_label(
    label_name: str,
    request: UpdateLabelRequest,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Label:
    """Update a label by name."""
    storage.sync()

    labels = storage.read_labels()

    target: Label | None = None
    for label in labels:
        if label.name == label_name:
            target = label
            break

    if target is None:
        raise HTTPException(status_code=404, detail=f"Label '{label_name}' not found")

    old_name = target.name

    if request.new_name is not None:
        target.name = request.new_name
    if request.color is not None:
        target.color = request.color
    if request.description is not None:
        target.description = request.description

    # If the name changed, update all issues that reference this label.
    if target.name != old_name:
        if storage.issues_dir.exists():
            for path in storage.issues_dir.glob("*.json"):
                issue = storage.read_issue(int(path.stem))
                if issue is None:
                    continue
                changed = False
                for issue_label in issue.labels:
                    if issue_label.name == old_name:
                        issue_label.name = target.name
                        changed = True
                if changed:
                    storage.write_issue(issue)

    storage.write_labels(labels)
    storage.commit(f"Update label '{old_name}'")
    storage.push()

    return target


@router.delete("/projects/{name}/labels/{label_name}", status_code=204)
async def delete_label(
    label_name: str,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Response:
    """Delete a label by name."""
    storage.sync()

    labels = storage.read_labels()

    original_count = len(labels)
    labels = [label for label in labels if label.name != label_name]

    if len(labels) == original_count:
        raise HTTPException(status_code=404, detail=f"Label '{label_name}' not found")

    # Remove from all issues that reference this label.
    if storage.issues_dir.exists():
        for path in storage.issues_dir.glob("*.json"):
            issue = storage.read_issue(int(path.stem))
            if issue is None:
                continue
            original_issue_labels = len(issue.labels)
            issue.labels = [lbl for lbl in issue.labels if lbl.name != label_name]
            if len(issue.labels) != original_issue_labels:
                storage.write_issue(issue)

    storage.write_labels(labels)
    storage.commit(f"Delete label '{label_name}'")
    storage.push()

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Issue-level label endpoints
# ---------------------------------------------------------------------------


@router.get("/projects/{name}/issues/{number}/labels")
async def list_issue_labels(
    number: int,
    storage: ProjectStorage = Depends(get_project_storage),
) -> list[Label]:
    """List labels on an issue."""
    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")
    return issue.labels


@router.post("/projects/{name}/issues/{number}/labels")
async def add_labels_to_issue(
    number: int,
    labels: list[str] = Body(..., embed=True),
    storage: ProjectStorage = Depends(get_project_storage),
) -> list[Label]:
    """Add labels to an issue."""
    storage.sync()

    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")

    repo_labels = storage.read_labels()
    repo_labels_by_name = {label.name: label for label in repo_labels}
    existing_names = {label.name for label in issue.labels}

    for label_name in labels:
        if label_name in repo_labels_by_name and label_name not in existing_names:
            issue.labels.append(repo_labels_by_name[label_name])
            existing_names.add(label_name)

    storage.write_issue(issue)
    storage.commit(f"Add labels to issue #{number}")
    storage.push()

    return issue.labels


@router.put("/projects/{name}/issues/{number}/labels")
async def replace_issue_labels(
    number: int,
    labels: list[str] = Body(..., embed=True),
    storage: ProjectStorage = Depends(get_project_storage),
) -> list[Label]:
    """Replace all labels on an issue."""
    storage.sync()

    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")

    repo_labels = storage.read_labels()
    repo_labels_by_name = {label.name: label for label in repo_labels}

    issue.labels = [
        repo_labels_by_name[name] for name in labels if name in repo_labels_by_name
    ]

    storage.write_issue(issue)
    storage.commit(f"Replace labels on issue #{number}")
    storage.push()

    return issue.labels


@router.delete("/projects/{name}/issues/{number}/labels", status_code=204)
async def remove_all_issue_labels(
    number: int,
    storage: ProjectStorage = Depends(get_project_storage),
) -> Response:
    """Remove all labels from an issue."""
    storage.sync()

    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")

    issue.labels = []
    storage.write_issue(issue)
    storage.commit(f"Remove all labels from issue #{number}")
    storage.push()

    return Response(status_code=204)


@router.delete("/projects/{name}/issues/{number}/labels/{label}")
async def remove_label_from_issue(
    number: int,
    label: str,
    storage: ProjectStorage = Depends(get_project_storage),
) -> list[Label]:
    """Remove a single label from an issue."""
    storage.sync()

    issue = storage.read_issue(number)
    if issue is None:
        raise HTTPException(status_code=404, detail=f"Issue #{number} not found")

    original_count = len(issue.labels)
    issue.labels = [lbl for lbl in issue.labels if lbl.name != label]

    if len(issue.labels) == original_count:
        raise HTTPException(
            status_code=404,
            detail=f"Label '{label}' not found on issue #{number}",
        )

    storage.write_issue(issue)
    storage.commit(f"Remove label '{label}' from issue #{number}")
    storage.push()

    return issue.labels
