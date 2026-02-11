import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@/api";
import type { RecentProject, RepoInfo, RepoCreateForbiddenInfo } from "@/types";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FolderGit2,
  Plus,
  FolderOpen,
  Github,
  Settings,
  LogOut,
  X,
  Loader2,
  ExternalLink,
  ChevronDown,
  Lock,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return typeof err === "string" ? err : "An unexpected error occurred";
}

const REPO_FORBIDDEN_PREFIX = "REPO_CREATE_FORBIDDEN:";

function parseRepoForbidden(err: unknown): RepoCreateForbiddenInfo | null {
  if (typeof err !== "string") return null;
  if (!err.startsWith(REPO_FORBIDDEN_PREFIX)) return null;
  try {
    return JSON.parse(err.slice(REPO_FORBIDDEN_PREFIX.length));
  } catch {
    return null;
  }
}

function timeAgo(dateString: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(dateString).toLocaleDateString();
}

// ─── Mode Toggle ──────────────────────────────────────────────────────────────

function ModeToggle({
  mode,
  onModeChange,
  disabled,
}: {
  mode: "local" | "github";
  onModeChange: (mode: "local" | "github") => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-full items-center rounded-lg border bg-muted/40 p-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onModeChange("local")}
        className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          mode === "local"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <FolderOpen className="size-3.5" />
        Local Folder
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onModeChange("github")}
        className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          mode === "github"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Github className="size-3.5" />
        GitHub Repo
      </button>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectPicker() {
  const navigate = useNavigate();

  // ── Recent projects ────────────────────────────────────────────────────────
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);

  // ── Dialog visibility ──────────────────────────────────────────────────────
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [existingDialogOpen, setExistingDialogOpen] = useState(false);
  const [patDialogOpen, setPatDialogOpen] = useState(false);

  // ── New Project state ──────────────────────────────────────────────────────
  const [newMode, setNewMode] = useState<"local" | "github">("local");
  const [newParentPath, setNewParentPath] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [newGhDescription, setNewGhDescription] = useState("");
  const [newGhPrivate, setNewGhPrivate] = useState(true);
  const [newCreating, setNewCreating] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  // ── Existing Project state ─────────────────────────────────────────────────
  const [existingMode, setExistingMode] = useState<"local" | "github">("local");
  const [existingOpening, setExistingOpening] = useState(false);
  const [existingGhRepos, setExistingGhRepos] = useState<RepoInfo[]>([]);
  const [existingGhLoading, setExistingGhLoading] = useState(false);
  const [existingGhError, setExistingGhError] = useState<string | null>(null);
  const [existingGhParentPath, setExistingGhParentPath] = useState("");
  const [existingGhSelected, setExistingGhSelected] = useState<RepoInfo | null>(null);
  const [existingGhOpening, setExistingGhOpening] = useState(false);

  // ── Change PAT state ───────────────────────────────────────────────────────
  const [newToken, setNewToken] = useState("");
  const [changingPat, setChangingPat] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);

  // ── Repo creation forbidden guided flow ───────────────────────────
  const [repoForbidden, setRepoForbidden] = useState<RepoCreateForbiddenInfo | null>(null);
  const [settingUpRepo, setSettingUpRepo] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  //  Data fetching
  // ═══════════════════════════════════════════════════════════════════════════

  const fetchRecent = useCallback(async () => {
    setLoadingRecent(true);
    setRecentError(null);
    try {
      const projects = await api.listRecentProjects();
      setRecentProjects(projects);
    } catch (err) {
      setRecentError(errMsg(err));
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => {
    fetchRecent();
  }, [fetchRecent]);

  // ═══════════════════════════════════════════════════════════════════════════
  //  Navigation helper
  // ═══════════════════════════════════════════════════════════════════════════

  const goToProject = async (project: RecentProject) => {
    await api.selectProject(project.owner, project.repo, project.local_path);
    navigate(`/project/${project.owner}/${project.repo}`, {
      state: {
        projectName: project.local_path.split("/").pop() || project.local_path,
        localPath: project.local_path,
      },
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  New Project
  // ═══════════════════════════════════════════════════════════════════════════

  const handleBrowseNewParent = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) setNewParentPath(selected);
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newParentPath || !newFolderName.trim()) return;

    setNewCreating(true);
    setNewError(null);
    try {
      let project: RecentProject;
      if (newMode === "local") {
        project = await api.createLocalProject(newParentPath, newFolderName.trim());
      } else {
        project = await api.createGithubProject(
          newFolderName.trim(),
          newGhDescription.trim(),
          newGhPrivate,
          newParentPath,
        );
      }
      setNewDialogOpen(false);
      resetNewForm();
      await goToProject(project);
    } catch (err) {
      const forbidden = parseRepoForbidden(err);
      if (forbidden) {
        setNewDialogOpen(false);
        resetNewForm();
        setRepoForbidden(forbidden);
      } else {
        setNewError(errMsg(err));
      }
    } finally {
      setNewCreating(false);
    }
  };

  const resetNewForm = () => {
    setNewMode("local");
    setNewParentPath("");
    setNewFolderName("");
    setNewGhDescription("");
    setNewGhPrivate(true);
    setNewError(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Existing Project
  // ═══════════════════════════════════════════════════════════════════════════

  const openExistingDialog = () => {
    setExistingDialogOpen(true);
    setExistingMode("local");
    setExistingGhSelected(null);
    setExistingGhParentPath("");
    setExistingGhError(null);
  };

  const handleOpenExistingLocal = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    setExistingOpening(true);
    try {
      const project = await api.openLocalProject(selected);
      setExistingDialogOpen(false);
      await goToProject(project);
    } catch (err) {
      const forbidden = parseRepoForbidden(err);
      if (forbidden) {
        setExistingDialogOpen(false);
        setRepoForbidden(forbidden);
      } else {
        setRecentError(errMsg(err));
      }
    } finally {
      setExistingOpening(false);
    }
  };

  const switchExistingToGithub = async () => {
    setExistingMode("github");
    setExistingGhLoading(true);
    setExistingGhError(null);
    try {
      const repos = await api.listProjects("");
      setExistingGhRepos(repos);
    } catch (err) {
      setExistingGhError(errMsg(err));
    } finally {
      setExistingGhLoading(false);
    }
  };

  const handleBrowseExistingGhParent = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) setExistingGhParentPath(selected);
  };

  const handleOpenExistingGithub = async () => {
    if (!existingGhSelected || !existingGhParentPath) return;

    setExistingGhOpening(true);
    setExistingGhError(null);
    try {
      const project = await api.openGithubProject(
        existingGhSelected.owner.login,
        existingGhSelected.name,
        existingGhParentPath,
      );
      setExistingDialogOpen(false);
      await goToProject(project);
    } catch (err) {
      const forbidden = parseRepoForbidden(err);
      if (forbidden) {
        setExistingDialogOpen(false);
        setRepoForbidden(forbidden);
      } else {
        setExistingGhError(errMsg(err));
      }
    } finally {
      setExistingGhOpening(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Recent projects
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSelectRecent = async (project: RecentProject) => {
    try {
      await goToProject(project);
    } catch (err) {
      setRecentError(errMsg(err));
    }
  };

  const handleRemoveRecent = async (e: React.MouseEvent, localPath: string) => {
    e.stopPropagation();
    try {
      await api.removeRecentProject(localPath);
      setRecentProjects((prev) => prev.filter((p) => p.local_path !== localPath));
    } catch (err) {
      setRecentError(errMsg(err));
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Repo creation forbidden – guided flow
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSetupBackingRepo = async () => {
    if (!repoForbidden) return;
    setSettingUpRepo(true);
    setSetupError(null);
    try {
      const project = await api.setupBackingRepo(
        repoForbidden.owner,
        repoForbidden.repo_name,
        repoForbidden.project_path,
      );
      setRepoForbidden(null);
      await goToProject(project);
    } catch (err) {
      setSetupError(errMsg(err));
    } finally {
      setSettingUpRepo(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Change PAT
  // ═══════════════════════════════════════════════════════════════════════════

  const handleChangePat = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newToken.trim();
    if (!trimmed) return;

    setChangingPat(true);
    setPatError(null);
    try {
      await api.setToken(trimmed);
      setPatDialogOpen(false);
      setNewToken("");
      fetchRecent();
    } catch (err) {
      setPatError(errMsg(err));
    } finally {
      setChangingPat(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-8 py-12">
      {/* Header */}
      <div className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <FolderGit2 className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Attractor Issues
          </h1>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Settings className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setPatDialogOpen(true)}>
              <LogOut className="mr-2 size-4" />
              Change Token
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Action tiles ─────────────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-2 gap-3">
        {/* New Project */}
        <button
          onClick={() => setNewDialogOpen(true)}
          className="group flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-card px-6 py-8 text-center transition-all duration-150 hover:border-border hover:bg-accent/50 hover:shadow-sm active:scale-[0.98]"
        >
          <div className="flex size-11 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-accent">
            <Plus className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
          </div>
          <span className="text-sm font-medium text-foreground">
            New Project
          </span>
        </button>

        {/* Open Existing */}
        <button
          onClick={openExistingDialog}
          className="group flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-card px-6 py-8 text-center transition-all duration-150 hover:border-border hover:bg-accent/50 hover:shadow-sm active:scale-[0.98]"
        >
          <div className="flex size-11 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-accent">
            <FolderOpen className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {existingOpening ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Opening...
              </span>
            ) : (
              "Open Project"
            )}
          </span>
        </button>
      </div>

      {/* ── Recent Projects ──────────────────────────────────────────── */}
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Recent
        </p>

        {recentError && (
          <p className="mb-3 text-sm text-destructive">{recentError}</p>
        )}

        {loadingRecent ? (
          <div className="py-12">
            <LoadingSpinner size={24} label="Loading recent projects..." />
          </div>
        ) : recentProjects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No recent projects"
            description="Create or open a project to get started."
          />
        ) : (
          <div className="divide-y divide-border/60 rounded-xl border border-border/60">
            {recentProjects.map((project) => (
              <button
                key={project.local_path}
                onClick={() => handleSelectRecent(project)}
                className="group relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40"
              >
                <FolderGit2 className="size-4 shrink-0 text-muted-foreground/60" />
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm font-medium text-foreground">
                    {project.local_path.split("/").pop() || project.local_path}
                  </span>
                  <p className="truncate text-xs text-muted-foreground/70">
                    {project.local_path}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground/60 transition-opacity group-hover:opacity-0">
                  {timeAgo(project.last_opened)}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="absolute right-3 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  onClick={(e) => handleRemoveRecent(e, project.local_path)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRemoveRecent(e as unknown as React.MouseEvent, project.local_path);
                    }
                  }}
                >
                  <X className="size-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/*  DIALOGS                                                       */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {/* ── New Project dialog ─────────────────────────────────────── */}
      <Dialog
        open={newDialogOpen}
        onOpenChange={(o) => {
          setNewDialogOpen(o);
          if (!o) resetNewForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateNew}>
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
              <DialogDescription>
                Create a new project. Issue tracking is set up automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <ModeToggle mode={newMode} onModeChange={setNewMode} disabled={newCreating} />

              <div className="space-y-2">
                <Label htmlFor="new-parent">Parent Directory</Label>
                <div className="flex gap-2">
                  <Input
                    id="new-parent"
                    placeholder="Select a directory..."
                    value={newParentPath}
                    readOnly
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowseNewParent}
                    disabled={newCreating}
                  >
                    Browse
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-name">
                  {newMode === "local" ? "Folder Name" : "Repository Name"}
                </Label>
                <Input
                  id="new-name"
                  placeholder="my-project"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  disabled={newCreating}
                  autoFocus
                />
              </div>

              {/* GitHub-specific fields */}
              {newMode === "github" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="new-gh-desc">Description</Label>
                    <Textarea
                      id="new-gh-desc"
                      placeholder="What is this project about?"
                      value={newGhDescription}
                      onChange={(e) => setNewGhDescription(e.target.value)}
                      disabled={newCreating}
                      rows={3}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="new-gh-private"
                        className="cursor-pointer text-sm font-medium"
                      >
                        {newGhPrivate ? "Private" : "Public"}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {newGhPrivate
                          ? "Only you can see this repository."
                          : "Anyone on the internet can see this repository."}
                      </p>
                    </div>
                    <button
                      id="new-gh-private"
                      type="button"
                      role="switch"
                      aria-checked={newGhPrivate}
                      disabled={newCreating}
                      onClick={() => setNewGhPrivate((v) => !v)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${newGhPrivate ? "bg-primary" : "bg-input"}`}
                    >
                      <span
                        className={`pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${newGhPrivate ? "translate-x-4" : "translate-x-0"}`}
                      />
                    </button>
                  </div>
                </>
              )}

              {newError && (
                <p className="text-sm text-destructive">{newError}</p>
              )}
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewDialogOpen(false)}
                disabled={newCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={newCreating || !newParentPath || !newFolderName.trim()}
              >
                {newCreating ? (
                  <LoadingSpinner size={16} label="Creating..." />
                ) : (
                  "Create"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Existing Project dialog ────────────────────────────────── */}
      <Dialog
        open={existingDialogOpen}
        onOpenChange={(o) => {
          setExistingDialogOpen(o);
          if (!o) {
            setExistingMode("local");
            setExistingGhSelected(null);
            setExistingGhParentPath("");
            setExistingGhError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Open Project</DialogTitle>
            <DialogDescription>
              Open a project folder or clone a GitHub repository.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <ModeToggle
              mode={existingMode}
              onModeChange={(m) => {
                if (m === "github" && existingMode !== "github") {
                  switchExistingToGithub();
                } else {
                  setExistingMode(m);
                }
              }}
              disabled={existingGhOpening}
            />

            {existingMode === "local" ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <p className="text-sm text-muted-foreground">
                  Select a project folder. Issue tracking will be configured
                  automatically if needed.
                </p>
                <Button
                  onClick={handleOpenExistingLocal}
                  disabled={existingOpening}
                >
                  {existingOpening ? (
                    <LoadingSpinner size={16} label="Opening..." />
                  ) : (
                    <>
                      <FolderOpen className="mr-2 size-4" />
                      Browse for Folder
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {existingGhLoading ? (
                  <div className="py-8">
                    <LoadingSpinner size={24} label="Loading repositories..." />
                  </div>
                ) : existingGhError && !existingGhSelected ? (
                  <div className="space-y-3">
                    <p className="text-sm text-destructive">{existingGhError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={switchExistingToGithub}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Repo picker */}
                    <div className="space-y-2">
                      <Label>Repository</Label>
                      {existingGhSelected ? (
                        <div className="flex items-center justify-between rounded-md border p-3">
                          <div className="flex items-center gap-2 text-sm">
                            <Github className="size-4 text-muted-foreground" />
                            <span className="font-medium">{existingGhSelected.full_name}</span>
                            {existingGhSelected.private && (
                              <Lock className="size-3 text-muted-foreground" />
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExistingGhSelected(null)}
                            disabled={existingGhOpening}
                          >
                            Change
                          </Button>
                        </div>
                      ) : (
                        <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border p-2">
                          {existingGhRepos.length === 0 ? (
                            <p className="py-4 text-center text-sm text-muted-foreground">
                              No repositories found.
                            </p>
                          ) : (
                            existingGhRepos.map((repo) => (
                              <button
                                key={repo.id}
                                type="button"
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50"
                                onClick={() => setExistingGhSelected(repo)}
                              >
                                <Github className="size-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate">{repo.full_name}</span>
                                {repo.private && (
                                  <Lock className="size-3 shrink-0 text-muted-foreground" />
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    {/* Clone location */}
                    {existingGhSelected && (
                      <div className="space-y-2">
                        <Label htmlFor="existing-gh-parent">Clone To</Label>
                        <div className="flex gap-2">
                          <Input
                            id="existing-gh-parent"
                            placeholder="Select where to clone..."
                            value={existingGhParentPath}
                            readOnly
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleBrowseExistingGhParent}
                            disabled={existingGhOpening}
                          >
                            Browse
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Will be cloned to:{" "}
                          {existingGhParentPath
                            ? `${existingGhParentPath}/${existingGhSelected.name}`
                            : "..."}
                        </p>
                      </div>
                    )}

                    {existingGhError && existingGhSelected && (
                      <p className="text-sm text-destructive">{existingGhError}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setExistingDialogOpen(false)}
              disabled={existingGhOpening}
            >
              Cancel
            </Button>
            {existingMode === "github" && existingGhSelected && (
              <Button
                onClick={handleOpenExistingGithub}
                disabled={existingGhOpening || !existingGhParentPath}
              >
                {existingGhOpening ? (
                  <LoadingSpinner size={16} label="Opening..." />
                ) : (
                  "Open"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change PAT dialog ──────────────────────────────────────── */}
      <Dialog open={patDialogOpen} onOpenChange={setPatDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleChangePat}>
            <DialogHeader>
              <DialogTitle>Change GitHub Token</DialogTitle>
              <DialogDescription>
                Enter a new Personal Access Token to switch accounts or update
                permissions.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-3">
              <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3 text-sm">
                <a
                  href="https://github.com/settings/personal-access-tokens/new?name=attractor-issues&description=Attractor+Issues+desktop+app&contents=write&administration=write"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary underline underline-offset-4 hover:text-primary/80"
                >
                  Create a new token on GitHub
                  <ExternalLink className="size-3.5" />
                </a>

                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-180">
                    <ChevronDown className="size-3.5 transition-transform duration-200" />
                    Token permissions &amp; scope
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2 text-xs text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">Required permissions:</span>
                    </p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      <li><strong>Contents</strong> &mdash; read &amp; write</li>
                      <li><strong>Metadata</strong> &mdash; read-only</li>
                      <li><strong>Administration</strong> &mdash; read &amp; write</li>
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-pat">Personal Access Token</Label>
                <Input
                  id="new-pat"
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  disabled={changingPat}
                  autoFocus
                />
              </div>
              {patError && (
                <p className="text-sm text-destructive">{patError}</p>
              )}
            </div>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPatDialogOpen(false)}
                disabled={changingPat}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={changingPat || !newToken.trim()}
              >
                {changingPat ? (
                  <LoadingSpinner size={16} label="Validating..." />
                ) : (
                  "Update Token"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Create repo manually dialog ─────────────────────────── */}
      <Dialog
        open={repoForbidden !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRepoForbidden(null);
            setSetupError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Repository on GitHub</DialogTitle>
            <DialogDescription>
              Your token doesn&apos;t have permission to create repositories.
              Please create this repo on GitHub, then click continue.
            </DialogDescription>
          </DialogHeader>
          {repoForbidden && (
            <div className="mt-4 space-y-4">
              <div className="rounded-md border border-border bg-muted/50 p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Create a <strong>private</strong> repository named:
                </p>
                <p className="font-mono text-sm font-semibold bg-background rounded px-3 py-2 border">
                  {repoForbidden.repo_name}
                </p>
                <a
                  href={`https://github.com/new?name=${encodeURIComponent(repoForbidden.repo_name)}&visibility=private&description=${encodeURIComponent("Attractor backing store")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary underline underline-offset-4 hover:text-primary/80 text-sm"
                >
                  Create on GitHub
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
              {setupError && (
                <p className="text-sm text-destructive">{setupError}</p>
              )}
            </div>
          )}
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRepoForbidden(null);
                setSetupError(null);
              }}
              disabled={settingUpRepo}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSetupBackingRepo}
              disabled={settingUpRepo}
            >
              {settingUpRepo ? (
                <LoadingSpinner size={16} label="Setting up..." />
              ) : (
                "I\u2019ve created it \u2014 continue setup"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
