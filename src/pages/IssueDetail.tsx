import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { api } from "@/api";
import type { Issue, Comment, Label, Milestone, AmplifierSessionInfo } from "@/types";
import { LabelBadge } from "@/components/LabelBadge";
import { TimeAgo } from "@/components/TimeAgo";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label as FormLabel } from "@/components/ui/label";
import {
  ArrowLeft,
  Check,
  CircleDot,
  Edit2,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Play,
  Square,
  Tag,
  Trash2,
  Unlock,
  X,
  Zap,
} from "lucide-react";

export function IssueDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { owner, repo, issueNumber: issueNumStr } =
    useParams<{ owner: string; repo: string; issueNumber: string }>();
  const routerState = location.state as { projectName?: string; localPath?: string } | null;

  const issueNumber = Number(issueNumStr);

  // ── Issue state ────────────────────────────────────────────────────
  const [issue, setIssue] = useState<Issue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Comments ───────────────────────────────────────────────────────
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentPage, setCommentPage] = useState(1);
  const [commentTotalCount, setCommentTotalCount] = useState(0);

  // ── New comment ────────────────────────────────────────────────────
  const [newComment, setNewComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  // ── Title editing ──────────────────────────────────────────────────
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  // ── Body editing ───────────────────────────────────────────────────
  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");
  const [savingBody, setSavingBody] = useState(false);

  // ── Comment editing ────────────────────────────────────────────────
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);

  // ── Labels sidebar ─────────────────────────────────────────────────
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [allMilestones, setAllMilestones] = useState<Milestone[]>([]);
  const [labelsOpen, setLabelsOpen] = useState(false);

  // ── Lock dialog ────────────────────────────────────────────────────
  const [lockDialogOpen, setLockDialogOpen] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [locking, setLocking] = useState(false);

  // ── Amplifier session ─────────────────────────────────────
  const [amplifierSession, setAmplifierSession] =
    useState<AmplifierSessionInfo | null>(null);
  const [amplifierLoading, setAmplifierLoading] = useState(false);

  if (!owner || !repo || !issueNumber) return null;

  // ── Fetch issue ────────────────────────────────────────────────────
  const fetchIssue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getIssue(owner, repo, issueNumber);
      setIssue(data);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to load issue");
    } finally {
      setLoading(false);
    }
  }, [owner, repo, issueNumber]);

  // ── Fetch comments ─────────────────────────────────────────────────
  const fetchComments = useCallback(async () => {
    setCommentsLoading(true);
    try {
      const res = await api.listComments(owner, repo, issueNumber, {
        page: commentPage,
        perPage: 50,
      });
      setComments(res.items);
      setCommentTotalCount(res.total_count);
    } catch {
      // Comments failure is non-fatal
    } finally {
      setCommentsLoading(false);
    }
  }, [owner, repo, issueNumber, commentPage]);

  useEffect(() => {
    fetchIssue();
  }, [fetchIssue]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Fetch sidebar data
  useEffect(() => {
    api.listLabels(owner, repo).then(setAllLabels).catch(() => {});
    api.listMilestones(owner, repo).then(setAllMilestones).catch(() => {});
  }, [owner, repo]);

  // Fetch Amplifier session status on mount
  useEffect(() => {
    api
      .amplifierStatus(owner, repo, issueNumber)
      .then(setAmplifierSession)
      .catch(() => {});
  }, [owner, repo, issueNumber]);

  // Listen for Amplifier session events
  useEffect(() => {
    const listeners = [
      listen<{ issueNumber: number; commentId?: number }>(
        "amplifier:completed",
        (event) => {
          if (event.payload.issueNumber === issueNumber) {
            api
              .amplifierStatus(owner, repo, issueNumber)
              .then(setAmplifierSession)
              .catch(() => {});
            fetchComments();
          }
        },
      ),
      listen<{ issueNumber: number; error?: string }>(
        "amplifier:failed",
        (event) => {
          if (event.payload.issueNumber === issueNumber) {
            api
              .amplifierStatus(owner, repo, issueNumber)
              .then(setAmplifierSession)
              .catch(() => {});
            fetchComments();
          }
        },
      ),
      listen<{ issueNumber: number }>("amplifier:started", (event) => {
        if (event.payload.issueNumber === issueNumber) {
          api
            .amplifierStatus(owner, repo, issueNumber)
            .then(setAmplifierSession)
            .catch(() => {});
        }
      }),
    ];

    return () => {
      listeners.forEach((p) => p.then((unlisten) => unlisten()));
    };
  }, [owner, repo, issueNumber, fetchComments]);

  // ── Handlers ───────────────────────────────────────────────────────

  const handleToggleState = async () => {
    if (!issue) return;
    const newState = issue.state === "open" ? "closed" : "open";
    const stateReason =
      newState === "closed" ? "completed" : "reopened";
    try {
      const updated = await api.updateIssue(owner, repo, issueNumber, {
        issueState: newState,
        stateReason,
      });
      setIssue(updated);
    } catch {
      // Silently fail — could add toast
    }
  };

  const handleSaveTitle = async () => {
    if (!titleDraft.trim() || !issue) return;
    setSavingTitle(true);
    try {
      const updated = await api.updateIssue(owner, repo, issueNumber, {
        title: titleDraft.trim(),
      });
      setIssue(updated);
      setEditingTitle(false);
    } catch {
      // keep editing open
    } finally {
      setSavingTitle(false);
    }
  };

  const handleSaveBody = async () => {
    if (!issue) return;
    setSavingBody(true);
    try {
      const updated = await api.updateIssue(owner, repo, issueNumber, {
        body: bodyDraft,
      });
      setIssue(updated);
      setEditingBody(false);
    } catch {
      // keep editing open
    } finally {
      setSavingBody(false);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    setSubmittingComment(true);
    try {
      await api.createComment(owner, repo, issueNumber, newComment.trim());
      setNewComment("");
      fetchComments();
      // Update comment count on issue
      if (issue) setIssue({ ...issue, comments: issue.comments + 1 });
    } catch {
      // Could show error
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleEditComment = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setCommentDraft(comment.body);
  };

  const handleSaveComment = async () => {
    if (editingCommentId === null || !commentDraft.trim()) return;
    setSavingComment(true);
    try {
      const updated = await api.updateComment(
        owner,
        repo,
        editingCommentId,
        commentDraft.trim(),
      );
      setComments((prev) =>
        prev.map((c) => (c.id === editingCommentId ? updated : c)),
      );
      setEditingCommentId(null);
      setCommentDraft("");
    } catch {
      // keep editing
    } finally {
      setSavingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    try {
      await api.deleteComment(owner, repo, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      if (issue) setIssue({ ...issue, comments: Math.max(0, issue.comments - 1) });
    } catch {
      // Could show error
    }
  };

  const handleToggleLabel = async (labelName: string) => {
    if (!issue) return;
    const hasLabel = issue.labels.some((l) => l.name === labelName);
    try {
      if (hasLabel) {
        await api.removeIssueLabel(owner, repo, issueNumber, labelName);
      } else {
        await api.addIssueLabels(owner, repo, issueNumber, [labelName]);
      }
      // Refetch to get accurate state
      const updated = await api.getIssue(owner, repo, issueNumber);
      setIssue(updated);
    } catch {
      // Silent fail
    }
  };

  const handleMilestoneChange = async (value: string) => {
    if (!issue) return;
    try {
      const milestoneNum = value === "__none__" ? undefined : Number(value);
      // To clear milestone, we update with milestone: 0 or similar
      // The backend should handle undefined or 0 to clear
      const updated = await api.updateIssue(owner, repo, issueNumber, {
        milestone: milestoneNum,
      });
      setIssue(updated);
    } catch {
      // Silent fail
    }
  };

  const handleLock = async () => {
    setLocking(true);
    try {
      await api.lockIssue(
        owner,
        repo,
        issueNumber,
        lockReason || undefined,
      );
      const updated = await api.getIssue(owner, repo, issueNumber);
      setIssue(updated);
      setLockDialogOpen(false);
      setLockReason("");
    } catch {
      // Silent fail
    } finally {
      setLocking(false);
    }
  };

  const handleUnlock = async () => {
    try {
      await api.unlockIssue(owner, repo, issueNumber);
      const updated = await api.getIssue(owner, repo, issueNumber);
      setIssue(updated);
    } catch {
      // Silent fail
    }
  };

  // ── Amplifier handlers ─────────────────────────────────────

  const handleAmplifierRun = async () => {
    setAmplifierLoading(true);
    try {
      await api.amplifierRun(owner, repo, issueNumber);
      // Status will update via the amplifier:started event listener
    } catch (err) {
      console.error("Failed to start Amplifier session:", err);
    } finally {
      setAmplifierLoading(false);
    }
  };

  const handleAmplifierCancel = async () => {
    try {
      await api.amplifierCancel(owner, repo, issueNumber);
      const updated = await api.amplifierStatus(owner, repo, issueNumber);
      setAmplifierSession(updated);
    } catch (err) {
      console.error("Failed to cancel Amplifier session:", err);
    }
  };

  const commentPages = Math.max(1, Math.ceil(commentTotalCount / 50));

  // ── Loading / Error ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size={32} label="Loading issue..." />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <EmptyState
          title="Failed to load issue"
          description={error ?? "Issue not found"}
          actionLabel="Go Back"
          onAction={() => navigate(`/project/${owner}/${repo}`, { state: routerState })}
        />
      </div>
    );
  }

  const isOpen = issue.state === "open";

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-6">
      {/* Top bar */}
      <div className="mb-4 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(`/project/${owner}/${repo}`, { state: routerState })}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <span className="text-sm text-muted-foreground">
          {owner}/{repo}
        </span>
      </div>

      {/* Title row */}
      <div className="mb-4">
        {editingTitle ? (
          <div className="flex items-center gap-2">
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="text-xl font-bold"
              autoFocus
              disabled={savingTitle}
            />
            <Button
              size="sm"
              onClick={handleSaveTitle}
              disabled={savingTitle || !titleDraft.trim()}
            >
              {savingTitle ? <LoadingSpinner size={14} /> : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditingTitle(false)}
              disabled={savingTitle}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="group flex items-start gap-2">
            <h1 className="text-2xl font-bold leading-tight">
              {issue.title}
              <span className="ml-2 font-normal text-muted-foreground">
                #{issue.number}
              </span>
            </h1>
            <Button
              variant="ghost"
              size="icon"
              className="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100"
              onClick={() => {
                setTitleDraft(issue.title);
                setEditingTitle(true);
              }}
            >
              <Edit2 className="size-4" />
            </Button>
          </div>
        )}

        {/* State badge + meta */}
        <div className="mt-2 flex items-center gap-3">
          <Badge
            variant={isOpen ? "default" : "secondary"}
            className={
              isOpen
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-purple-600 text-white hover:bg-purple-700"
            }
          >
            {isOpen ? (
              <CircleDot className="mr-1 size-3.5" />
            ) : (
              <Check className="mr-1 size-3.5" />
            )}
            {isOpen ? "Open" : "Closed"}
          </Badge>

          <span className="text-sm text-muted-foreground">
            {issue.user.login} opened this issue{" "}
            <TimeAgo date={issue.created_at} className="text-sm" />
            {" · "}
            {issue.comments} comment{issue.comments !== 1 ? "s" : ""}
          </span>

          {issue.locked && (
            <Badge variant="outline" className="text-xs">
              <Lock className="mr-1 size-3" />
              Locked
              {issue.lock_reason && `: ${issue.lock_reason}`}
            </Badge>
          )}
        </div>
      </div>

      <Separator className="mb-6" />

      {/* Main content: body + comments | sidebar */}
      <div className="flex gap-8">
        {/* Left: body + comments */}
        <div className="min-w-0 flex-1">
          {/* Issue body */}
          <div className="mb-6 rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
              <Avatar className="size-6">
                <AvatarImage
                  src={issue.user.avatar_url}
                  alt={issue.user.login}
                />
                <AvatarFallback className="text-xs">
                  {issue.user.login[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">
                {issue.user.login}
              </span>
              <TimeAgo
                date={issue.created_at}
                className="text-xs text-muted-foreground"
              />
              {issue.author_association !== "NONE" && (
                <Badge variant="outline" className="text-xs font-normal">
                  {issue.author_association.toLowerCase()}
                </Badge>
              )}
              <div className="flex-1" />
              {!editingBody && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => {
                    setBodyDraft(issue.body ?? "");
                    setEditingBody(true);
                  }}
                >
                  <Edit2 className="size-3.5" />
                </Button>
              )}
            </div>

            <div className="p-4">
              {editingBody ? (
                <div className="space-y-2">
                  <Textarea
                    value={bodyDraft}
                    onChange={(e) => setBodyDraft(e.target.value)}
                    rows={8}
                    disabled={savingBody}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveBody}
                      disabled={savingBody}
                    >
                      {savingBody ? (
                        <LoadingSpinner size={14} />
                      ) : (
                        "Update"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingBody(false)}
                      disabled={savingBody}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : issue.body ? (
                <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm">
                  {issue.body}
                </div>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  No description provided.
                </p>
              )}
            </div>
          </div>

          {/* Comments */}
          {commentsLoading ? (
            <LoadingSpinner size={20} label="Loading comments..." />
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <CommentCard
                  key={comment.id}
                  comment={comment}
                  isEditing={editingCommentId === comment.id}
                  editDraft={commentDraft}
                  savingEdit={savingComment}
                  onEditDraftChange={setCommentDraft}
                  onStartEdit={() => handleEditComment(comment)}
                  onSaveEdit={handleSaveComment}
                  onCancelEdit={() => {
                    setEditingCommentId(null);
                    setCommentDraft("");
                  }}
                  onDelete={() => handleDeleteComment(comment.id)}
                />
              ))}

              {/* Comment pagination */}
              {commentPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={commentPage <= 1}
                    onClick={() =>
                      setCommentPage((p) => Math.max(1, p - 1))
                    }
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {commentPage} of {commentPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={commentPage >= commentPages}
                    onClick={() => setCommentPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* New comment form */}
          <Separator className="my-6" />
          <form onSubmit={handleSubmitComment} className="space-y-3">
            <Textarea
              placeholder={
                issue.locked
                  ? "This issue is locked."
                  : "Leave a comment..."
              }
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={4}
              disabled={submittingComment || issue.locked}
            />
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                disabled={
                  submittingComment || !newComment.trim() || issue.locked
                }
              >
                {submittingComment ? (
                  <LoadingSpinner size={16} label="Posting..." />
                ) : (
                  <>
                    <MessageSquare className="mr-2 size-4" />
                    Comment
                  </>
                )}
              </Button>

              <div className="flex-1" />

              {/* Close/Reopen button */}
              <Button
                type="button"
                variant={isOpen ? "outline" : "default"}
                onClick={handleToggleState}
              >
                {isOpen ? (
                  <>
                    <Check className="mr-2 size-4 text-purple-600" />
                    Close Issue
                  </>
                ) : (
                  <>
                    <CircleDot className="mr-2 size-4 text-green-600" />
                    Reopen Issue
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>

        {/* Right sidebar */}
        <aside className="hidden w-64 shrink-0 space-y-6 lg:block">
          {/* Labels */}
          <SidebarSection title="Labels">
            <DropdownMenu open={labelsOpen} onOpenChange={setLabelsOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full justify-start p-1 text-xs text-muted-foreground"
                >
                  <Tag className="mr-1.5 size-3.5" />
                  Edit labels
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="max-h-64 w-56 overflow-y-auto"
                align="start"
              >
                {allLabels.map((label) => (
                  <DropdownMenuCheckboxItem
                    key={label.id}
                    checked={issue.labels.some(
                      (l) => l.name === label.name,
                    )}
                    onCheckedChange={() => handleToggleLabel(label.name)}
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
            {issue.labels.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {issue.labels.map((label) => (
                  <LabelBadge key={label.id} label={label} />
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                None yet
              </p>
            )}
          </SidebarSection>

          {/* Assignees */}
          <SidebarSection title="Assignees">
            {issue.assignees.length > 0 ? (
              <div className="space-y-2">
                {issue.assignees.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-2"
                  >
                    <Avatar className="size-5">
                      <AvatarImage
                        src={user.avatar_url}
                        alt={user.login}
                      />
                      <AvatarFallback className="text-[10px]">
                        {user.login[0]?.toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{user.login}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No one assigned
              </p>
            )}
          </SidebarSection>

          {/* Milestone */}
          <SidebarSection title="Milestone">
            <Select
              value={
                issue.milestone
                  ? String(issue.milestone.number)
                  : "__none__"
              }
              onValueChange={handleMilestoneChange}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="No milestone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No milestone</SelectItem>
                {allMilestones.map((ms) => (
                  <SelectItem key={ms.id} value={String(ms.number)}>
                    {ms.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {issue.milestone && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{issue.milestone.title}</span>
                  <span>
                    {issue.milestone.open_issues +
                      issue.milestone.closed_issues >
                    0
                      ? `${Math.round(
                          (issue.milestone.closed_issues /
                            (issue.milestone.open_issues +
                              issue.milestone.closed_issues)) *
                            100,
                        )}%`
                      : "0%"}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted">
                  <div
                    className="h-1.5 rounded-full bg-green-600 transition-all"
                    style={{
                      width: `${
                        issue.milestone.open_issues +
                          issue.milestone.closed_issues >
                        0
                          ? (issue.milestone.closed_issues /
                              (issue.milestone.open_issues +
                                issue.milestone.closed_issues)) *
                            100
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
          </SidebarSection>

          {/* Lock */}
          <SidebarSection title="Lock">
            {issue.locked ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={handleUnlock}
              >
                <Unlock className="mr-1.5 size-3.5" />
                Unlock issue
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setLockDialogOpen(true)}
              >
                <Lock className="mr-1.5 size-3.5" />
                Lock issue
              </Button>
            )}
          </SidebarSection>

          {/* Amplifier */}
          <SidebarSection title="Amplifier">
            {amplifierSession?.status === "running" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Session running...</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={handleAmplifierCancel}
                >
                  <Square className="mr-1.5 size-3.5" />
                  Cancel session
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {amplifierSession?.status === "completed" && (
                  <div className="flex items-center gap-2 text-xs text-green-600">
                    <Check className="size-3.5" />
                    <span>Session completed</span>
                  </div>
                )}
                {amplifierSession?.status === "failed" && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-red-600">
                      <X className="size-3.5" />
                      <span>Session failed</span>
                    </div>
                    {amplifierSession.error && (
                      <p className="text-xs text-muted-foreground truncate" title={amplifierSession.error}>
                        {amplifierSession.error}
                      </p>
                    )}
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  disabled={amplifierLoading}
                  onClick={handleAmplifierRun}
                >
                  {amplifierLoading ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Zap className="mr-1.5 size-3.5" />
                  )}
                  {amplifierSession ? "Run again" : "Run Amplifier"}
                </Button>
              </div>
            )}
          </SidebarSection>
        </aside>
      </div>

      {/* Lock dialog */}
      <Dialog open={lockDialogOpen} onOpenChange={setLockDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Lock issue</DialogTitle>
            <DialogDescription>
              Locking limits conversation to collaborators.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <div className="space-y-2">
              <FormLabel htmlFor="lock-reason">
                Reason (optional)
              </FormLabel>
              <Select value={lockReason} onValueChange={setLockReason}>
                <SelectTrigger id="lock-reason">
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off-topic">Off-topic</SelectItem>
                  <SelectItem value="too heated">Too heated</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="spam">Spam</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setLockDialogOpen(false)}
              disabled={locking}
            >
              Cancel
            </Button>
            <Button onClick={handleLock} disabled={locking}>
              {locking ? (
                <LoadingSpinner size={14} label="Locking..." />
              ) : (
                "Lock issue"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function CommentCard({
  comment,
  isEditing,
  editDraft,
  savingEdit,
  onEditDraftChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  comment: Comment;
  isEditing: boolean;
  editDraft: string;
  savingEdit: boolean;
  onEditDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
        <Avatar className="size-6">
          <AvatarImage
            src={comment.user.avatar_url}
            alt={comment.user.login}
          />
          <AvatarFallback className="text-xs">
            {comment.user.login[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium">{comment.user.login}</span>
        <TimeAgo
          date={comment.created_at}
          className="text-xs text-muted-foreground"
        />
        {comment.author_association !== "NONE" && (
          <Badge variant="outline" className="text-xs font-normal">
            {comment.author_association.toLowerCase()}
          </Badge>
        )}
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="size-7 p-0">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onStartEdit}>
              <Edit2 className="mr-2 size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="p-4">
        {isEditing ? (
          <div className="space-y-2">
            <Textarea
              value={editDraft}
              onChange={(e) => onEditDraftChange(e.target.value)}
              rows={4}
              disabled={savingEdit}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={onSaveEdit}
                disabled={savingEdit || !editDraft.trim()}
              >
                {savingEdit ? <LoadingSpinner size={14} /> : "Update"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelEdit}
                disabled={savingEdit}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm">
            {comment.body}
          </div>
        )}
      </div>
    </div>
  );
}
