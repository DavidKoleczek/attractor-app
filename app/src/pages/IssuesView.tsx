import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  Plus,
  CircleDot,
  CheckCircle2,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Tag,
  ArrowUpDown,
  Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LabelBadge } from "@/components/LabelBadge"
import { CreateLabelForm } from "@/components/CreateLabelForm"
import { TimeAgo } from "@/components/TimeAgo"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { EmptyState } from "@/components/EmptyState"
import { api, type ProjectInfo } from "@/api"
import { ws } from "@/ws"
import type { Issue, Label } from "@/types"

const PER_PAGE = 30

type StateFilter = "open" | "closed" | "all"
type SortField = "created" | "updated" | "comments"
type Direction = "desc" | "asc"

function StateTabButton({
  label,
  value,
  current,
  onClick,
  icon: Icon,
}: {
  label: string
  value: StateFilter
  current: StateFilter
  onClick: (v: StateFilter) => void
  icon?: React.ComponentType<{ className?: string }>
}) {
  const active = value === current
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
      onClick={() => onClick(value)}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {label}
    </button>
  )
}

export default function IssuesView() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const project = name!

  // Project info
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null)

  // Issues
  const [issues, setIssues] = useState<Issue[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [stateFilter, setStateFilter] = useState<StateFilter>("open")
  const [labelFilter, setLabelFilter] = useState<string[]>([])
  const [sort, setSort] = useState<SortField>("created")
  const [direction, setDirection] = useState<Direction>("desc")

  // Labels for filter dropdown
  const [allLabels, setAllLabels] = useState<Label[]>([])

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newBody, setNewBody] = useState("")
  const [newLabels, setNewLabels] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingLabel, setCreatingLabel] = useState(false)

  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE))

  const fetchIssues = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listIssues(project, {
        state: stateFilter === "all" ? undefined : stateFilter,
        labels: labelFilter.length > 0 ? labelFilter.join(",") : undefined,
        sort,
        direction,
        page,
        per_page: PER_PAGE,
      })
      setIssues(res.items)
      setTotalCount(res.total_count)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues")
    } finally {
      setLoading(false)
    }
  }, [project, stateFilter, labelFilter, sort, direction, page])

  // Fetch project info + labels once
  useEffect(() => {
    api.getProject(project).then(setProjectInfo).catch(() => {})
    api.listLabels(project).then(setAllLabels).catch(() => {})
  }, [project])

  // Fetch issues on filter/page change
  useEffect(() => {
    fetchIssues()
  }, [fetchIssues])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [stateFilter, labelFilter, sort, direction])

  // WebSocket subscriptions
  useEffect(() => {
    const unsub1 = ws.on("issue:created", (data: unknown) => {
      const d = data as { project: string }
      if (d.project === project) fetchIssues()
    })
    const unsub2 = ws.on("issue:updated", (data: unknown) => {
      const d = data as { project: string }
      if (d.project === project) fetchIssues()
    })
    return () => {
      unsub1()
      unsub2()
    }
  }, [project, fetchIssues])

  async function handleCreate() {
    if (!newTitle.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      await api.createIssue(project, {
        title: newTitle.trim(),
        body: newBody.trim() || undefined,
        labels: newLabels.length > 0 ? newLabels : undefined,
      })
      setCreateOpen(false)
      setNewTitle("")
      setNewBody("")
      setNewLabels([])
      fetchIssues()
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create issue",
      )
    } finally {
      setCreating(false)
    }
  }

  async function handleCreateLabel(
    labelName: string,
    color: string,
    description?: string,
  ) {
    await api.createLabel(project, { name: labelName, color, description })
    const labels = await api.listLabels(project)
    setAllLabels(labels)
  }

  function toggleLabelFilter(labelName: string) {
    setLabelFilter((prev) =>
      prev.includes(labelName)
        ? prev.filter((l) => l !== labelName)
        : [...prev, labelName],
    )
  }

  function toggleNewLabel(labelName: string) {
    setNewLabels((prev) =>
      prev.includes(labelName)
        ? prev.filter((l) => l !== labelName)
        : [...prev, labelName],
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      {/* Header */}
      <div className="mb-6 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-xl font-bold">{project}</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/project/${encodeURIComponent(project)}/settings`)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open)
            if (!open) {
              setNewTitle("")
              setNewBody("")
              setNewLabels([])
              setCreateError(null)
              setCreatingLabel(false)
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Issue
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>New Issue</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                disabled={creating}
                autoFocus
              />
              <Textarea
                placeholder="Description (optional)"
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                disabled={creating}
                rows={4}
              />
              <div>
                <div className="mb-2 text-sm font-medium">Labels</div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {allLabels.map((l) => (
                    <button
                      key={l.name}
                      type="button"
                      onClick={() => toggleNewLabel(l.name)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                        newLabels.includes(l.name)
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      <span
                        className="mr-1.5 inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: `#${l.color}` }}
                      />
                      {l.name}
                    </button>
                  ))}
                </div>
                {creatingLabel ? (
                  <CreateLabelForm
                    onSubmit={handleCreateLabel}
                    onCancel={() => setCreatingLabel(false)}
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreatingLabel(true)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Create label
                  </Button>
                )}
              </div>
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
            <DialogFooter>
              <Button
                onClick={handleCreate}
                disabled={creating || !newTitle.trim()}
              >
                {creating ? "Creating..." : "Create Issue"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
        {projectInfo && (
          <div className="ml-11 space-y-0.5 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground/70">Project:</span>{" "}
              <code className="rounded bg-muted px-1 py-0.5">{projectInfo.path}</code>
            </div>
            <div>
              <span className="font-medium text-foreground/70">Issues:</span>{" "}
              <code className="rounded bg-muted px-1 py-0.5">{projectInfo.issues_path}</code>
            </div>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex items-center justify-between border-b">
        <div className="flex">
          <StateTabButton
            label="Open"
            value="open"
            current={stateFilter}
            onClick={setStateFilter}
            icon={CircleDot}
          />
          <StateTabButton
            label="Closed"
            value="closed"
            current={stateFilter}
            onClick={setStateFilter}
            icon={CheckCircle2}
          />
          <StateTabButton
            label="All"
            value="all"
            current={stateFilter}
            onClick={setStateFilter}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          {/* Label filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Tag className="mr-1 h-3.5 w-3.5" />
                Labels
                {labelFilter.length > 0 && (
                  <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                    {labelFilter.length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {allLabels.map((l) => (
                <DropdownMenuCheckboxItem
                  key={l.name}
                  checked={labelFilter.includes(l.name)}
                  onCheckedChange={() => toggleLabelFilter(l.name)}
                >
                  <span
                    className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: `#${l.color}` }}
                  />
                  {l.name}
                </DropdownMenuCheckboxItem>
              ))}
              {allLabels.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No labels
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
                Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["created", "updated", "comments"] as const).map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={sort === s}
                  onCheckedChange={() => setSort(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Direction toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setDirection((d) => (d === "desc" ? "asc" : "desc"))
            }
            title={direction === "desc" ? "Newest first" : "Oldest first"}
          >
            {direction === "desc" ? "\u2193" : "\u2191"}
          </Button>
        </div>
      </div>

      {/* Issue list */}
      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner label="Loading issues..." />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && issues.length === 0 && (
        <EmptyState
          icon={CircleDot}
          title="No issues found"
          description={
            stateFilter !== "all"
              ? `No ${stateFilter} issues. Try changing filters.`
              : "Create an issue to get started."
          }
          actionLabel="New Issue"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {!loading && !error && issues.length > 0 && (
        <div className="divide-y">
          {issues.map((issue) => (
            <div
              key={issue.id}
              className="flex cursor-pointer items-start gap-3 px-2 py-3 transition-colors hover:bg-accent/50"
              onClick={() =>
                navigate(
                  `/project/${encodeURIComponent(project)}/issues/${issue.number}`,
                )
              }
            >
              {issue.state === "open" ? (
                <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-purple-600" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{issue.title}</span>
                  {issue.labels.map((l) => (
                    <LabelBadge key={l.id} label={l} />
                  ))}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  #{issue.number} opened{" "}
                  <TimeAgo date={issue.created_at} /> by {issue.user.login}
                </div>
              </div>
              {issue.comments > 0 && (
                <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {issue.comments}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
