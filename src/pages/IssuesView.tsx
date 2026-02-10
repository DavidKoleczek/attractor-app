import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import type { Issue, Label, Milestone } from "@/types";
import { LabelBadge } from "@/components/LabelBadge";
import { TimeAgo } from "@/components/TimeAgo";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label as FormLabel } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  Circle,
  CircleDot,
  ExternalLink,
  MessageSquare,
  Plus,
  Tag,
  CircleOff,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

const PER_PAGE = 30;

type StateFilter = "open" | "closed" | "all";
type SortField = "created" | "updated" | "comments";
type SortDirection = "desc" | "asc";

export function IssuesView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const routerState = location.state as { projectName?: string; localPath?: string } | null;
  const projectName = routerState?.projectName || repo || '';
  const localPath = routerState?.localPath;

  // ── Issues state ───────────────────────────────────────────────────
  const [issues, setIssues] = useState<Issue[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Filters ────────────────────────────────────────────────────────
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [milestoneFilter, setMilestoneFilter] = useState<string>("");
  const [sort, setSort] = useState<SortField>("created");
  const [direction, setDirection] = useState<SortDirection>("desc");

  // ── Sidebar data (labels & milestones for filters) ─────────────────
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [allMilestones, setAllMilestones] = useState<Milestone[]>([]);

  // ── New issue dialog ───────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newLabels, setNewLabels] = useState<string[]>([]);
  const [newMilestone, setNewMilestone] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (!owner || !repo) return null;

  // ── Fetch issues ───────────────────────────────────────────────────
  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number | undefined> = {
        state: stateFilter,
        sort,
        direction,
        page,
        perPage: PER_PAGE,
      };
      if (labelFilter) params.labels = labelFilter;
      if (milestoneFilter) params.milestone = milestoneFilter;

      const res = await api.listIssues(owner, repo, params);
      setIssues(res.items);
      setTotalCount(res.total_count);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, [owner, repo, stateFilter, labelFilter, milestoneFilter, sort, direction, page]);

  // ── Fetch labels & milestones for filter dropdowns ─────────────────
  useEffect(() => {
    api.listLabels(owner, repo).then(setAllLabels).catch(() => {});
    api.listMilestones(owner, repo).then(setAllMilestones).catch(() => {});
  }, [owner, repo]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [stateFilter, labelFilter, milestoneFilter, sort, direction]);

  // ── Create issue ───────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setCreating(true);
    setCreateError(null);
    try {
      const data: {
        title: string;
        body?: string;
        labels?: string[];
        milestone?: number;
      } = { title: newTitle.trim() };
      if (newBody.trim()) data.body = newBody.trim();
      if (newLabels.length > 0) data.labels = newLabels;
      if (newMilestone) data.milestone = Number(newMilestone);

      await api.createIssue(owner, repo, data);
      setCreateOpen(false);
      setNewTitle("");
      setNewBody("");
      setNewLabels([]);
      setNewMilestone("");
      fetchIssues();
    } catch (err) {
      setCreateError(typeof err === "string" ? err : "Failed to create issue");
    } finally {
      setCreating(false);
    }
  };

  const toggleNewLabel = (name: string) => {
    setNewLabels((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name],
    );
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {projectName}
            </h1>
            {localPath && (
              <p className="text-xs text-muted-foreground truncate max-w-md">
                {localPath}
              </p>
            )}
            {owner && repo && (
              <button
                type="button"
                onClick={() => openUrl(`https://github.com/${owner}/${repo}`)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Data Store: {owner}/{repo}
                <ExternalLink className="size-3" />
              </button>
            )}
          </div>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 size-4" />
              New Issue
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>New Issue</DialogTitle>
                <DialogDescription>
                  Create a new issue for {owner}/{repo}.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  <FormLabel htmlFor="issue-title">Title</FormLabel>
                  <Input
                    id="issue-title"
                    placeholder="Issue title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    disabled={creating}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <FormLabel htmlFor="issue-body">Description</FormLabel>
                  <Textarea
                    id="issue-body"
                    placeholder="Describe the issue..."
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    disabled={creating}
                    rows={6}
                  />
                </div>

                {/* Label picker */}
                {allLabels.length > 0 && (
                  <div className="space-y-2">
                    <FormLabel>Labels</FormLabel>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start"
                          disabled={creating}
                        >
                          <Tag className="mr-2 size-4" />
                          {newLabels.length > 0
                            ? `${newLabels.length} selected`
                            : "Select labels"}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-60 overflow-y-auto">
                        {allLabels.map((label) => (
                          <DropdownMenuCheckboxItem
                            key={label.id}
                            checked={newLabels.includes(label.name)}
                            onCheckedChange={() => toggleNewLabel(label.name)}
                            onSelect={(e) => e.preventDefault()}
                          >
                            <span
                              className="mr-2 inline-block size-3 rounded-full"
                              style={{ backgroundColor: `#${label.color}` }}
                            />
                            {label.name}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {newLabels.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {newLabels.map((name) => {
                          const label = allLabels.find(
                            (l) => l.name === name,
                          );
                          if (!label) return null;
                          return (
                            <LabelBadge
                              key={label.id}
                              label={label}
                              onRemove={() => toggleNewLabel(name)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Milestone picker */}
                {allMilestones.length > 0 && (
                  <div className="space-y-2">
                    <FormLabel>Milestone</FormLabel>
                    <Select
                      value={newMilestone}
                      onValueChange={setNewMilestone}
                      disabled={creating}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select milestone" />
                      </SelectTrigger>
                      <SelectContent>
                        {allMilestones.map((ms) => (
                          <SelectItem
                            key={ms.id}
                            value={String(ms.number)}
                          >
                            {ms.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {createError && (
                  <p className="text-sm text-destructive">{createError}</p>
                )}
              </div>
              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={creating || !newTitle.trim()}
                >
                  {creating ? (
                    <LoadingSpinner size={16} label="Creating..." />
                  ) : (
                    "Create Issue"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* State tabs */}
        <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
          <StateTabButton
            active={stateFilter === "open"}
            onClick={() => setStateFilter("open")}
          >
            <CircleDot className="mr-1.5 size-4 text-green-600" />
            Open
          </StateTabButton>
          <StateTabButton
            active={stateFilter === "closed"}
            onClick={() => setStateFilter("closed")}
          >
            <Check className="mr-1.5 size-4 text-purple-600" />
            Closed
          </StateTabButton>
          <StateTabButton
            active={stateFilter === "all"}
            onClick={() => setStateFilter("all")}
          >
            <Circle className="mr-1.5 size-4" />
            All
          </StateTabButton>
        </div>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Label filter */}
        <Select
          value={labelFilter}
          onValueChange={(v) => setLabelFilter(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Label" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All labels</SelectItem>
            {allLabels.map((label) => (
              <SelectItem key={label.id} value={label.name}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: `#${label.color}` }}
                  />
                  {label.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Milestone filter */}
        {allMilestones.length > 0 && (
          <Select
            value={milestoneFilter}
            onValueChange={(v) =>
              setMilestoneFilter(v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Milestone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All milestones</SelectItem>
              {allMilestones.map((ms) => (
                <SelectItem key={ms.id} value={String(ms.number)}>
                  {ms.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Sort */}
        <Select
          value={sort}
          onValueChange={(v) => setSort(v as SortField)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created">Newest</SelectItem>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="comments">Most commented</SelectItem>
          </SelectContent>
        </Select>

        {/* Direction toggle */}
        <Button
          variant="outline"
          size="icon"
          onClick={() =>
            setDirection((d) => (d === "desc" ? "asc" : "desc"))
          }
          title={direction === "desc" ? "Descending" : "Ascending"}
        >
          {direction === "desc" ? (
            <ArrowDownAZ className="size-4" />
          ) : (
            <ArrowUpAZ className="size-4" />
          )}
        </Button>
      </div>

      {/* Issue list */}
      {loading ? (
        <div className="py-20">
          <LoadingSpinner size={28} label="Loading issues..." />
        </div>
      ) : error ? (
        <EmptyState
          title="Failed to load issues"
          description={error}
          actionLabel="Retry"
          onAction={fetchIssues}
        />
      ) : issues.length === 0 ? (
        <EmptyState
          icon={CircleOff}
          title="No issues found"
          description={
            stateFilter === "open"
              ? "There are no open issues. Great job!"
              : "No issues match the current filters."
          }
          actionLabel="New Issue"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <>
          <div className="divide-y rounded-lg border">
            {issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                onClick={() =>
                  navigate(
                    `/project/${owner}/${repo}/issues/${issue.number}`,
                  )
                }
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="px-2 text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function StateTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function IssueRow({
  issue,
  onClick,
}: {
  issue: Issue;
  onClick: () => void;
}) {
  const isOpen = issue.state === "open";

  return (
    <div
      className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
      onClick={onClick}
    >
      {/* State icon */}
      <div className="mt-0.5 shrink-0">
        {isOpen ? (
          <CircleDot className="size-5 text-green-600" />
        ) : (
          <Check className="size-5 text-purple-600" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold leading-tight hover:text-primary">
            {issue.title}
          </span>
          {issue.labels.map((label) => (
            <LabelBadge key={label.id} label={label} />
          ))}
        </div>

        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span>#{issue.number}</span>
          <span>
            opened <TimeAgo date={issue.created_at} className="text-xs" /> by{" "}
            {issue.user.login}
          </span>
          {issue.milestone && (
            <Badge variant="outline" className="text-xs font-normal">
              {issue.milestone.title}
            </Badge>
          )}
        </div>
      </div>

      {/* Right side: assignees + comments */}
      <div className="flex shrink-0 items-center gap-3">
        {/* Assignee avatars */}
        {issue.assignees.length > 0 && (
          <div className="flex -space-x-1.5">
            {issue.assignees.slice(0, 3).map((assignee) => (
              <Avatar
                key={assignee.id}
                className="size-5 border-2 border-background"
              >
                <AvatarImage
                  src={assignee.avatar_url}
                  alt={assignee.login}
                />
                <AvatarFallback className="text-[10px]">
                  {assignee.login[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
        )}

        {/* Comment count */}
        {issue.comments > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare className="size-3.5" />
            {issue.comments}
          </span>
        )}
      </div>
    </div>
  );
}
