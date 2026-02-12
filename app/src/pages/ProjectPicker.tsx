import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FolderOpen, Plus, Trash2, Github, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { EmptyState } from "@/components/EmptyState"
import { GitHubSetupBanner } from "@/components/GitHubSetupBanner"
import { NewProjectFlow } from "@/components/NewProjectFlow"
import { api, type ProjectInfo } from "@/api"
import type { AppConfig } from "@/types"

export default function ProjectPicker() {
  const navigate = useNavigate()

  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New project flow
  const [createOpen, setCreateOpen] = useState(false)
  const [hasGitHubToken, setHasGitHubToken] = useState(false)

  // App config for recent projects
  const [config, setConfig] = useState<AppConfig | null>(null)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, cfg, gh] = await Promise.all([
        api.listProjects(),
        api.getConfig().catch(() => null),
        api.getGitHubStatus().catch(() => null),
      ])
      setProjects(list)
      if (cfg) setConfig(cfg)
      if (gh) setHasGitHubToken(gh.configured)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteProject(deleteTarget)
      setDeleteTarget(null)
      fetchProjects()
    } catch {
      // Error deleting -- close dialog and refresh anyway
      setDeleteTarget(null)
      fetchProjects()
    } finally {
      setDeleting(false)
    }
  }

  // Build recent projects list
  const recentNames = config?.recent_projects ?? []
  const recentProjects =
    recentNames.length > 0 && projects.length > 3
      ? recentNames
          .map((name) => projects.find((p) => p.name === name))
          .filter((p): p is ProjectInfo => p !== undefined)
      : []

  function renderProjectRow(project: ProjectInfo) {
    return (
      <div
        key={project.name}
        className="flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:bg-accent"
        onClick={() =>
          navigate(`/project/${encodeURIComponent(project.name)}`)
        }
      >
        <div className="flex items-center gap-3">
          <FolderOpen className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">{project.name}</span>
          {project.store?.github && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Github className="h-3 w-3" />
              {project.store.github.owner}/{project.store.github.repo}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            setDeleteTarget(project.name)
          }}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <GitHubSetupBanner />

      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Attractor</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      <NewProjectFlow
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={fetchProjects}
        hasGitHubToken={hasGitHubToken}
      />

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner label="Loading projects..." />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && projects.length === 0 && (
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Create a project to get started."
          actionLabel="New Project"
          onAction={() => setCreateOpen(true)}
        />
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="space-y-6">
          {/* Recent projects section */}
          {recentProjects.length > 0 && (
            <div className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Clock className="h-4 w-4" />
                Recent
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {recentProjects.map((project) => (
                  <div
                    key={`recent-${project.name}`}
                    className="flex min-w-[140px] cursor-pointer flex-col items-center gap-2 rounded-lg border px-4 py-3 text-center transition-colors hover:bg-accent"
                    onClick={() =>
                      navigate(
                        `/project/${encodeURIComponent(project.name)}`,
                      )
                    }
                  >
                    <FolderOpen className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {project.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All projects */}
          <div className="space-y-2">
            {recentProjects.length > 0 && (
              <h2 className="text-sm font-medium text-muted-foreground">
                All Projects
              </h2>
            )}
            {projects.map(renderProjectRow)}
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget}"? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
