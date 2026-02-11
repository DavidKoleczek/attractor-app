"""Git-backed JSON file storage for issue tracking projects."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .models import Comment, Issue, IssueFilters, Label, ListResponse, Meta


class ProjectStorage:
    """Manages a single project stored as JSON files in a local git repo.

    Directory layout::

        {project_path}/
          .git/
          meta.json
          labels.json
          issues/
            1.json
            2.json
          comments/
            1/
              1.json
              2.json
    """

    def __init__(self, project_path: Path) -> None:
        self.path = project_path
        self.issues_dir = project_path / "issues"
        self.comments_dir = project_path / "comments"

    # ------------------------------------------------------------------
    # Git helpers
    # ------------------------------------------------------------------

    def _git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=self.path,
            capture_output=True,
            text=True,
            check=check,
        )

    # ------------------------------------------------------------------
    # JSON helpers
    # ------------------------------------------------------------------

    def _write_json(self, path: Path, data: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2, default=str) + "\n")

    def _read_json(self, path: Path) -> object:
        return json.loads(path.read_text())

    # ------------------------------------------------------------------
    # Project lifecycle
    # ------------------------------------------------------------------

    def init(self) -> None:
        self.path.mkdir(parents=True, exist_ok=True)
        self._git("init")
        self.issues_dir.mkdir(exist_ok=True)
        self.comments_dir.mkdir(exist_ok=True)
        self._write_json(
            self.path / "meta.json",
            {"next_issue_id": 1, "next_comment_id": 1},
        )
        self._write_json(self.path / "labels.json", [])
        self._git("add", "-A")
        self._git("commit", "-m", "Initialize project")

    def exists(self) -> bool:
        return (self.path / ".git").is_dir()

    # ------------------------------------------------------------------
    # Meta
    # ------------------------------------------------------------------

    def read_meta(self) -> Meta:
        path = self.path / "meta.json"
        if not path.exists():
            return Meta()
        return Meta.model_validate(self._read_json(path))

    def write_meta(self, meta: Meta) -> None:
        self._write_json(self.path / "meta.json", meta.model_dump(mode="json"))

    def next_issue_id(self) -> int:
        meta = self.read_meta()
        current = meta.next_issue_id
        meta.next_issue_id = current + 1
        self.write_meta(meta)
        return current

    def next_comment_id(self) -> int:
        meta = self.read_meta()
        current = meta.next_comment_id
        meta.next_comment_id = current + 1
        self.write_meta(meta)
        return current

    # ------------------------------------------------------------------
    # Issues
    # ------------------------------------------------------------------

    def read_issue(self, number: int) -> Issue | None:
        path = self.issues_dir / f"{number}.json"
        if not path.exists():
            return None
        return Issue.model_validate(self._read_json(path))

    def write_issue(self, issue: Issue) -> None:
        path = self.issues_dir / f"{issue.number}.json"
        self._write_json(path, issue.model_dump(mode="json"))

    def list_issues(self, filters: IssueFilters) -> ListResponse[Issue]:
        issues: list[Issue] = []
        if self.issues_dir.exists():
            for path in self.issues_dir.glob("*.json"):
                issues.append(Issue.model_validate(self._read_json(path)))

        # State filter
        if filters.state and filters.state != "all":
            issues = [i for i in issues if i.state == filters.state]

        # Labels filter (AND logic)
        if filters.labels:
            required = {name.strip() for name in filters.labels.split(",")}
            issues = [
                i for i in issues if required <= {label.name for label in i.labels}
            ]

        # Assignee filter
        if filters.assignee is not None:
            if filters.assignee == "none":
                issues = [i for i in issues if not i.assignees]
            elif filters.assignee == "*":
                issues = [i for i in issues if i.assignees]
            else:
                login = filters.assignee
                issues = [
                    i for i in issues if any(a.login == login for a in i.assignees)
                ]

        total_count = len(issues)

        # Sort
        sort_key = filters.sort
        if sort_key == "created":
            issues.sort(key=lambda i: i.created_at)
        elif sort_key == "updated":
            issues.sort(key=lambda i: i.updated_at)
        elif sort_key == "comments":
            issues.sort(key=lambda i: i.comments)
        else:
            issues.sort(key=lambda i: i.created_at)

        if filters.direction == "desc":
            issues.reverse()

        # Paginate
        per_page = min(filters.per_page, 100)
        page = max(filters.page, 1)
        offset = (page - 1) * per_page
        items = issues[offset : offset + per_page]

        return ListResponse(
            items=items,
            total_count=total_count,
            page=page,
            per_page=per_page,
        )

    def delete_issue(self, number: int) -> None:
        issue_path = self.issues_dir / f"{number}.json"
        if issue_path.exists():
            issue_path.unlink()
        comments_path = self.comments_dir / str(number)
        if comments_path.exists():
            for f in comments_path.iterdir():
                f.unlink()
            comments_path.rmdir()

    # ------------------------------------------------------------------
    # Comments
    # ------------------------------------------------------------------

    def read_comment(self, issue_number: int, comment_id: int) -> Comment | None:
        path = self.comments_dir / str(issue_number) / f"{comment_id}.json"
        if not path.exists():
            return None
        return Comment.model_validate(self._read_json(path))

    def write_comment(self, issue_number: int, comment: Comment) -> None:
        path = self.comments_dir / str(issue_number) / f"{comment.id}.json"
        self._write_json(path, comment.model_dump(mode="json"))

    def list_comments(
        self, issue_number: int, page: int = 1, per_page: int = 30
    ) -> ListResponse[Comment]:
        comments: list[Comment] = []
        comment_dir = self.comments_dir / str(issue_number)
        if comment_dir.exists():
            for path in comment_dir.glob("*.json"):
                comments.append(Comment.model_validate(self._read_json(path)))

        comments.sort(key=lambda c: c.created_at)
        total_count = len(comments)

        per_page = min(per_page, 100)
        page = max(page, 1)
        offset = (page - 1) * per_page
        items = comments[offset : offset + per_page]

        return ListResponse(
            items=items,
            total_count=total_count,
            page=page,
            per_page=per_page,
        )

    def find_comment(self, comment_id: int) -> tuple[int, Comment] | None:
        if not self.comments_dir.exists():
            return None
        for issue_dir in self.comments_dir.iterdir():
            if not issue_dir.is_dir():
                continue
            path = issue_dir / f"{comment_id}.json"
            if path.exists():
                comment = Comment.model_validate(self._read_json(path))
                return int(issue_dir.name), comment
        return None

    def delete_comment(self, issue_number: int, comment_id: int) -> None:
        path = self.comments_dir / str(issue_number) / f"{comment_id}.json"
        if path.exists():
            path.unlink()

    # ------------------------------------------------------------------
    # Labels
    # ------------------------------------------------------------------

    def read_labels(self) -> list[Label]:
        path = self.path / "labels.json"
        if not path.exists():
            return []
        data = self._read_json(path)
        return [Label.model_validate(item) for item in data]  # type: ignore[union-attr]

    def write_labels(self, labels: list[Label]) -> None:
        self._write_json(
            self.path / "labels.json",
            [label.model_dump(mode="json") for label in labels],
        )

    # ------------------------------------------------------------------
    # Git operations
    # ------------------------------------------------------------------

    def commit(self, message: str) -> None:
        self._git("add", "-A")
        result = self._git("diff", "--cached", "--quiet", check=False)
        if result.returncode != 0:
            self._git("commit", "-m", message)

    def _has_remote(self) -> bool:
        result = self._git("remote", "get-url", "origin", check=False)
        return result.returncode == 0

    def sync(self) -> None:
        if self._has_remote():
            self._git("pull", "--ff-only")

    def push(self) -> None:
        if self._has_remote():
            self._git("push")
