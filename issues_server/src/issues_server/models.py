"""Pydantic models mirroring the GitHub Issues API shape."""

from __future__ import annotations

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


# ---------------------------------------------------------------------------
# Core domain models
# ---------------------------------------------------------------------------


class SimpleUser(BaseModel):
    """Minimal GitHub-compatible user representation."""

    model_config = ConfigDict(populate_by_name=True)

    login: str
    id: int
    avatar_url: str
    user_type: str = Field(alias="type")


ATTRACTOR_BOT = SimpleUser(
    login="attractor-bot",
    id=0,
    avatar_url="",
    user_type="Bot",
)


class Label(BaseModel):
    """Issue label with colour coding."""

    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    color: str
    description: str | None = None
    is_default: bool = Field(default=False, alias="default")


class Issue(BaseModel):
    """Full issue object returned by list / get endpoints."""

    id: int
    number: int
    title: str
    body: str | None = None
    state: str = "open"
    state_reason: str | None = None
    labels: list[Label] = []
    assignees: list[SimpleUser] = []
    comments: int = 0
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None = None
    closed_by: SimpleUser | None = None
    author_association: str = "OWNER"
    user: SimpleUser


class Comment(BaseModel):
    """Single comment on an issue."""

    id: int
    body: str
    user: SimpleUser
    created_at: datetime
    updated_at: datetime
    author_association: str = "OWNER"


# ---------------------------------------------------------------------------
# Persistence metadata
# ---------------------------------------------------------------------------


class Meta(BaseModel):
    """Auto-increment counters stored alongside project data."""

    next_issue_id: int = 1
    next_comment_id: int = 1


# ---------------------------------------------------------------------------
# Generic list response
# ---------------------------------------------------------------------------

T = TypeVar("T")


class ListResponse(BaseModel, Generic[T]):
    """Paginated list wrapper compatible with GitHub-style responses."""

    items: list[T]
    total_count: int
    page: int
    per_page: int


# ---------------------------------------------------------------------------
# Query / request models
# ---------------------------------------------------------------------------


class IssueFilters(BaseModel):
    """Query parameters for listing issues."""

    state: str | None = "open"
    labels: str | None = None  # comma-separated label names
    assignee: str | None = None
    sort: str = "created"
    direction: str = "desc"
    page: int = 1
    per_page: int = Field(default=30, le=100)


class CreateIssueRequest(BaseModel):
    title: str
    body: str | None = None
    assignees: list[str] = []
    labels: list[str] = []


class UpdateIssueRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    state: str | None = None
    state_reason: str | None = None
    assignees: list[str] | None = None
    labels: list[str] | None = None


class CreateCommentRequest(BaseModel):
    body: str


class UpdateCommentRequest(BaseModel):
    body: str


class CreateLabelRequest(BaseModel):
    name: str
    color: str
    description: str | None = None


class UpdateLabelRequest(BaseModel):
    new_name: str | None = None
    color: str | None = None
    description: str | None = None


# ---------------------------------------------------------------------------
# Amplifier integration
# ---------------------------------------------------------------------------


class AmplifierSessionInfo(BaseModel):
    """Tracks an Amplifier CLI session attached to an issue."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    issue_number: int
    status: str
    started_at: str
    finished_at: str | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Project / store configuration (Phase 1 – configurable store backing)
# ---------------------------------------------------------------------------


class StoreManifest(BaseModel):
    """Contents of ``.attractor-store.json`` inside a store directory."""

    store_id: str


class GitHubStoreConfig(BaseModel):
    """Optional GitHub remote metadata for a store."""

    owner: str
    repo: str
    remote_url: str


class StoreConfig(BaseModel):
    """Describes where a project's issues store lives on disk."""

    path: str
    github: GitHubStoreConfig | None = None


class ProjectConfig(BaseModel):
    """Persisted as ``project.json`` inside a project metadata directory."""

    name: str
    created_at: datetime
    store_id: str
    store: StoreConfig
