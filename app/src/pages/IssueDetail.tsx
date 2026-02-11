import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  CircleDot,
  CheckCircle2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Trash2,
  Plus,
  X,
  Play,
  Square,
  Loader2,
  Tag,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { LabelBadge } from "@/components/LabelBadge"
import { CreateLabelForm } from "@/components/CreateLabelForm"
import { TimeAgo } from "@/components/TimeAgo"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { api } from "@/api"
import { ws } from "@/ws"
import type {
  Issue,
  Comment as IssueComment,
  Label,
  AmplifierSessionInfo,
} from "@/types"

const COMMENTS_PER_PAGE = 50

export default function IssueDetail() {
  const { name, issueNumber: issueNumberStr } = useParams<{
    name: string
    issueNumber: string
  }>()
  const navigate = useNavigate()
  const project = name!
  const issueNumber = Number(issueNumberStr)

  // Issue
  const [issue, setIssue] = useState<Issue | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Comments
  const [comments, setComments] = useState<IssueComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [commentPage, setCommentPage] = useState(1)
  const [commentTotalCount, setCommentTotalCount] = useState(0)

  // New comment
  const [newComment, setNewComment] = useState("")
  const [submittingComment, setSubmittingComment] = useState(false)

  // Title editing
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState("")
  const [savingTitle, setSavingTitle] = useState(false)

  // Body editing
  const [editingBody, setEditingBody] = useState(false)
  const [bodyDraft, setBodyDraft] = useState("")
  const [savingBody, setSavingBody] = useState(false)

  // Comment editing
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [commentDraft, setCommentDraft] = useState("")
  const [savingComment, setSavingComment] = useState(false)

  // Labels sidebar
  const [allLabels, setAllLabels] = useState<Label[]>([])
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [creatingLabel, setCreatingLabel] = useState(false)

  // Amplifier
  const [amplifierStatus, setAmplifierStatus] =
    useState<AmplifierSessionInfo | null>(null)
  const [amplifierLoading, setAmplifierLoading] = useState(false)

  const commentTotalPages = Math.max(
    1,
    Math.ceil(commentTotalCount / COMMENTS_PER_PAGE),
  )

  const fetchIssue = useCallback(async () => {
    try {
      const data = await api.getIssue(project, issueNumber)
      setIssue(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issue")
    } finally {
      setLoading(false)
    }
  }, [project, issueNumber])

  const fetchComments = useCallback(async () => {
    setCommentsLoading(true)
    try {
      const res = await api.listComments(
        project,
        issueNumber,
        commentPage,
        COMMENTS_PER_PAGE,
      )
      setComments(res.items)
      setCommentTotalCount(res.total_count)
    } catch {
      // silent
    } finally {
      setCommentsLoading(false)
    }
  }, [project, issueNumber, commentPage])

  const fetchAmplifierStatus = useCallback(async () => {
    try {
      const status = await api.getAmplifierStatus(project, issueNumber)
      setAmplifierStatus(status)
    } catch {
      setAmplifierStatus(null)
    }
  }, [project, issueNumber])

  // Initial load
  useEffect(() => {
    fetchIssue()
    fetchComments()
    api.listLabels(project).then(setAllLabels).catch(() => {})
    fetchAmplifierStatus()
  }, [fetchIssue, fetchComments, fetchAmplifierStatus, project])

  // WebSocket subscriptions
  useEffect(() => {
    const unsubs = [
      ws.on("issue:updated", (data: unknown) => {
        const d = data as { project: string; issue: Issue }
        if (d.project === project && d.issue.number === issueNumber) {
          fetchIssue()
        }
      }),
      ws.on("comment:created", (data: unknown) => {
        const d = data as { project: string; issueNumber: number }
        if (d.project === project && d.issueNumber === issueNumber) {
          fetchComments()
        }
      }),
      ws.on("amplifier:started", (data: unknown) => {
        const d = data as { project: string; issueNumber: number }
        if (d.project === project && d.issueNumber === issueNumber) {
          setAmplifierStatus({
            issueNumber,
            status: "running",
            startedAt: new Date().toISOString(),
            finishedAt: null,
            error: null,
          })
        }
      }),
      ws.on("amplifier:completed", (data: unknown) => {
        const d = data as { project: string; issueNumber: number }
        if (d.project === project && d.issueNumber === issueNumber) {
          fetchAmplifierStatus()
          fetchComments()
        }
      }),
      ws.on("amplifier:failed", (data: unknown) => {
        const d = data as { project: string; issueNumber: number }
        if (d.project === project && d.issueNumber === issueNumber) {
          fetchAmplifierStatus()
        }
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [project, issueNumber, fetchIssue, fetchComments, fetchAmplifierStatus])

  // -- Title editing --
  function startEditTitle() {
    if (!issue) return
    setTitleDraft(issue.title)
    setEditingTitle(true)
  }

  async function saveTitle() {
    if (!issue || !titleDraft.trim()) return
    setSavingTitle(true)
    try {
      const updated = await api.updateIssue(project, issueNumber, {
        title: titleDraft.trim(),
      })
      setIssue(updated)
      setEditingTitle(false)
    } catch {
      // silent
    } finally {
      setSavingTitle(false)
    }
  }

  // -- Body editing --
  function startEditBody() {
    if (!issue) return
    setBodyDraft(issue.body ?? "")
    setEditingBody(true)
  }

  async function saveBody() {
    if (!issue) return
    setSavingBody(true)
    try {
      const updated = await api.updateIssue(project, issueNumber, {
        body: bodyDraft,
      })
      setIssue(updated)
      setEditingBody(false)
    } catch {
      // silent
    } finally {
      setSavingBody(false)
    }
  }

  // -- Issue state toggle --
  async function handleToggleState() {
    if (!issue) return
    const newState = issue.state === "open" ? "closed" : "open"
    const stateReason =
      newState === "closed" ? "completed" : "reopened"
    try {
      const updated = await api.updateIssue(project, issueNumber, {
        state: newState,
        state_reason: stateReason,
      })
      setIssue(updated)
    } catch {
      // silent
    }
  }

  // -- Comments --
  async function handleCreateComment() {
    if (!newComment.trim()) return
    setSubmittingComment(true)
    try {
      await api.createComment(project, issueNumber, newComment.trim())
      setNewComment("")
      fetchComments()
      if (issue) {
        setIssue({ ...issue, comments: issue.comments + 1 })
      }
    } catch {
      // silent
    } finally {
      setSubmittingComment(false)
    }
  }

  function startEditComment(comment: IssueComment) {
    setEditingCommentId(comment.id)
    setCommentDraft(comment.body)
  }

  async function saveComment(commentId: number) {
    setSavingComment(true)
    try {
      await api.updateComment(project, commentId, commentDraft)
      setEditingCommentId(null)
      fetchComments()
    } catch {
      // silent
    } finally {
      setSavingComment(false)
    }
  }

  async function deleteComment(commentId: number) {
    try {
      await api.deleteComment(project, commentId)
      fetchComments()
      if (issue) {
        setIssue({ ...issue, comments: Math.max(0, issue.comments - 1) })
      }
    } catch {
      // silent
    }
  }

  // -- Labels --
  async function handleAddLabel(labelName: string) {
    try {
      await api.addIssueLabels(project, issueNumber, [labelName])
      fetchIssue()
    } catch {
      // silent
    }
  }

  async function handleRemoveLabel(labelName: string) {
    try {
      await api.removeIssueLabel(project, issueNumber, labelName)
      fetchIssue()
    } catch {
      // silent
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
    setCreatingLabel(false)
    await api.addIssueLabels(project, issueNumber, [labelName])
    fetchIssue()
  }

  // -- Amplifier --
  async function handleRunAmplifier() {
    setAmplifierLoading(true)
    try {
      const status = await api.runAmplifier(project, issueNumber)
      setAmplifierStatus(status)
    } catch {
      // silent
    } finally {
      setAmplifierLoading(false)
    }
  }

  async function handleCancelAmplifier() {
    setAmplifierLoading(true)
    try {
      await api.cancelAmplifier(project, issueNumber)
      setAmplifierStatus(null)
    } catch {
      // silent
    } finally {
      setAmplifierLoading(false)
    }
  }

  // -- Render --
  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner label="Loading issue..." />
      </div>
    )
  }

  if (error || !issue) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? "Issue not found"}
        </div>
      </div>
    )
  }

  const issueLabelsSet = new Set(issue.labels.map((l) => l.name))
  const availableToAdd = allLabels.filter((l) => !issueLabelsSet.has(l.name))

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      {/* Top bar */}
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            navigate(`/project/${encodeURIComponent(project)}`)
          }
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span>{project}</span>
        <span>/</span>
        <span>Issues</span>
        <span>/</span>
        <span className="text-foreground">#{issueNumber}</span>
      </div>

      {/* Title */}
      <div className="mb-2">
        {editingTitle ? (
          <div className="flex items-center gap-2">
            <Input
              className="text-xl font-bold"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle()
                if (e.key === "Escape") setEditingTitle(false)
              }}
              disabled={savingTitle}
              autoFocus
            />
            <Button size="sm" onClick={saveTitle} disabled={savingTitle}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditingTitle(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <h1
            className="cursor-pointer text-2xl font-bold hover:text-muted-foreground"
            onClick={startEditTitle}
            title="Click to edit"
          >
            {issue.title}{" "}
            <span className="font-normal text-muted-foreground">
              #{issueNumber}
            </span>
          </h1>
        )}
      </div>

      {/* State + meta */}
      <div className="mb-6 flex items-center gap-3 text-sm">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${
            issue.state === "open" ? "bg-green-600" : "bg-purple-600"
          }`}
        >
          {issue.state === "open" ? (
            <CircleDot className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {issue.state === "open" ? "Open" : "Closed"}
        </span>
        <span className="text-muted-foreground">
          {issue.user.login} opened this <TimeAgo date={issue.created_at} />{" "}
          &middot;{" "}
          <MessageSquare className="inline h-3.5 w-3.5" /> {issue.comments}{" "}
          comment{issue.comments !== 1 ? "s" : ""}
        </span>
      </div>

      <Separator className="mb-6" />

      {/* Two-column layout */}
      <div className="flex gap-8">
        {/* Main column */}
        <div className="min-w-0 flex-1">
          {/* Body */}
          <div className="mb-8">
            {editingBody ? (
              <div className="space-y-2">
                <Textarea
                  value={bodyDraft}
                  onChange={(e) => setBodyDraft(e.target.value)}
                  rows={8}
                  disabled={savingBody}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveBody} disabled={savingBody}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingBody(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="cursor-pointer whitespace-pre-wrap rounded-md border p-4 text-sm hover:bg-accent/30"
                onClick={startEditBody}
                title="Click to edit"
              >
                {issue.body || (
                  <span className="italic text-muted-foreground">
                    No description provided. Click to add one.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="space-y-4">
            {commentsLoading && comments.length === 0 ? (
              <LoadingSpinner label="Loading comments..." />
            ) : (
              comments.map((comment) => (
                <CommentCard
                  key={comment.id}
                  comment={comment}
                  editing={editingCommentId === comment.id}
                  draft={editingCommentId === comment.id ? commentDraft : ""}
                  saving={
                    editingCommentId === comment.id ? savingComment : false
                  }
                  onStartEdit={() => startEditComment(comment)}
                  onSave={() => saveComment(comment.id)}
                  onCancelEdit={() => setEditingCommentId(null)}
                  onDraftChange={setCommentDraft}
                  onDelete={() => deleteComment(comment.id)}
                />
              ))
            )}
          </div>

          {/* Comment pagination */}
          {commentTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                disabled={commentPage <= 1}
                onClick={() => setCommentPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {commentPage} of {commentTotalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={commentPage >= commentTotalPages}
                onClick={() => setCommentPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}

          {/* New comment form */}
          <div className="mt-6 space-y-2">
            <Textarea
              placeholder="Leave a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={3}
              disabled={submittingComment}
            />
            <div className="flex items-center justify-between">
              <Button
                onClick={handleCreateComment}
                disabled={submittingComment || !newComment.trim()}
              >
                {submittingComment ? "Submitting..." : "Comment"}
              </Button>
              <Button
                variant={issue.state === "open" ? "destructive" : "default"}
                onClick={handleToggleState}
              >
                {issue.state === "open" ? "Close issue" : "Reopen issue"}
              </Button>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-64 shrink-0 space-y-6">
          {/* Labels */}
          <SidebarSection title="Labels" icon={Tag}>
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <LabelBadge
                  key={l.id}
                  label={l}
                  onRemove={() => handleRemoveLabel(l.name)}
                />
              ))}
              {issue.labels.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  No labels
                </span>
              )}
            </div>
            <div className="mt-2">
              <DropdownMenu open={labelsOpen} onOpenChange={setLabelsOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full">
                    <Plus className="mr-1 h-3 w-3" />
                    Add label
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {availableToAdd.map((l) => (
                    <DropdownMenuCheckboxItem
                      key={l.name}
                      checked={false}
                      onCheckedChange={() => {
                        handleAddLabel(l.name)
                        setLabelsOpen(false)
                      }}
                    >
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: `#${l.color}` }}
                      />
                      {l.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {availableToAdd.length === 0 && !creatingLabel && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      All labels applied
                    </div>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {creatingLabel ? (
                <div className="mt-2">
                  <CreateLabelForm
                    onSubmit={handleCreateLabel}
                    onCancel={() => setCreatingLabel(false)}
                  />
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full"
                  onClick={() => setCreatingLabel(true)}
                >
                  Create new label
                </Button>
              )}
            </div>
          </SidebarSection>

          {/* Amplifier */}
          <SidebarSection title="Amplifier" icon={Play}>
            {amplifierStatus?.status === "running" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running...
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={handleCancelAmplifier}
                  disabled={amplifierLoading}
                >
                  <Square className="mr-1 h-3 w-3" />
                  Cancel
                </Button>
              </div>
            ) : amplifierStatus?.status === "completed" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-4 w-4" />
                  Completed
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleRunAmplifier}
                  disabled={amplifierLoading}
                >
                  <Play className="mr-1 h-3 w-3" />
                  Run Again
                </Button>
              </div>
            ) : amplifierStatus?.status === "failed" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <X className="h-4 w-4" />
                  Failed
                </div>
                {amplifierStatus.error && (
                  <p className="text-xs text-muted-foreground">
                    {amplifierStatus.error}
                  </p>
                )}
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleRunAmplifier}
                  disabled={amplifierLoading}
                >
                  <Play className="mr-1 h-3 w-3" />
                  Retry
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="w-full"
                onClick={handleRunAmplifier}
                disabled={amplifierLoading}
              >
                <Play className="mr-1 h-3 w-3" />
                Run Amplifier
              </Button>
            )}
          </SidebarSection>
        </div>
      </div>
    </div>
  )
}

// -- Inline sub-components --

function SidebarSection({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </div>
  )
}

function CommentCard({
  comment,
  editing,
  draft,
  saving,
  onStartEdit,
  onSave,
  onCancelEdit,
  onDraftChange,
  onDelete,
}: {
  comment: IssueComment
  editing: boolean
  draft: string
  saving: boolean
  onStartEdit: () => void
  onSave: () => void
  onCancelEdit: () => void
  onDraftChange: (v: string) => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{comment.user.login}</span>
          <span className="text-muted-foreground">
            commented <TimeAgo date={comment.created_at} />
          </span>
          {comment.author_association &&
            comment.author_association !== "NONE" && (
              <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {comment.author_association}
              </span>
            )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onStartEdit}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="p-4">
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              rows={4}
              disabled={saving}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={onSave} disabled={saving}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm">{comment.body}</div>
        )}
      </div>
    </div>
  )
}
