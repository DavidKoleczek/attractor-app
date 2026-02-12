import { useState } from "react"
import { ArrowLeft, FolderOpen, Github, Plus, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { PathInput } from "@/components/PathInput"
import { GitHubRepoPicker } from "@/components/GitHubRepoPicker"
import { api } from "@/api"
import type { PathValidationResponse } from "@/types"

type Mode = null | "folder" | "github" | "empty"

interface NewProjectFlowProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  hasGitHubToken: boolean
}

const errorStatuses = new Set([
  "already_registered",
  "not_a_directory",
  "permission_denied",
])

export function NewProjectFlow({
  open,
  onOpenChange,
  onCreated,
  hasGitHubToken,
}: NewProjectFlowProps) {
  const [mode, setMode] = useState<Mode>(null)

  // Shared state
  const [projectName, setProjectName] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Folder mode
  const [folderPath, setFolderPath] = useState("")
  const [pathValidation, setPathValidation] =
    useState<PathValidationResponse | null>(null)

  // GitHub mode
  const [selectedOwner, setSelectedOwner] = useState("")
  const [selectedRepo, setSelectedRepo] = useState("")

  // Empty mode
  const [emptyPath, setEmptyPath] = useState("")
  const [emptyPathValidation, setEmptyPathValidation] =
    useState<PathValidationResponse | null>(null)

  function reset() {
    setMode(null)
    setProjectName("")
    setCreating(false)
    setError(null)
    setFolderPath("")
    setPathValidation(null)
    setSelectedOwner("")
    setSelectedRepo("")
    setEmptyPath("")
    setEmptyPathValidation(null)
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (!next) reset()
  }

  function handleBack() {
    setError(null)
    setMode(null)
  }

  function handlePathValidation(result: PathValidationResponse | null) {
    setPathValidation(result)
    if (result?.suggested_name) {
      setProjectName(result.suggested_name)
    }
  }

  function handleRepoSelect(owner: string, repo: string) {
    setSelectedOwner(owner)
    setSelectedRepo(repo)
    setProjectName(repo)
  }

  const folderHasError = pathValidation
    ? errorStatuses.has(pathValidation.status)
    : false

  const emptyPathHasError = emptyPathValidation
    ? errorStatuses.has(emptyPathValidation.status)
    : false

  async function handleCreate() {
    if (!projectName.trim()) return
    setCreating(true)
    setError(null)
    try {
      if (mode === "folder") {
        await api.createProjectAdvanced({
          name: projectName.trim(),
          mode: "folder",
          path: folderPath.trim(),
        })
      } else if (mode === "github") {
        await api.createProjectAdvanced({
          name: projectName.trim(),
          mode: "github",
          owner: selectedOwner,
          repo: selectedRepo,
        })
      } else if (mode === "empty") {
        await api.createProjectAdvanced({
          name: projectName.trim(),
          mode: "empty",
          ...(emptyPath.trim() ? { path: emptyPath.trim() } : {}),
        })
      }
      handleOpenChange(false)
      onCreated()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create project",
      )
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === null && "New Project"}
            {mode === "folder" && "Open Folder"}
            {mode === "github" && "Clone from GitHub"}
            {mode === "empty" && "New Empty Project"}
          </DialogTitle>
          <DialogDescription>
            {mode === null && "Choose how to create your project."}
            {mode === "folder" && "Point to an existing project directory."}
            {mode === "github" && "Clone a GitHub repository as the backing store."}
            {mode === "empty" && "Start a new project from scratch."}
          </DialogDescription>
        </DialogHeader>

        {/* Mode selection */}
        {mode === null && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card
              className="cursor-pointer gap-3 py-4 transition-colors hover:bg-accent"
              onClick={() => setMode("folder")}
            >
              <CardContent className="flex flex-col items-center gap-2 text-center">
                <FolderOpen className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">Open Folder</span>
                <span className="text-xs text-muted-foreground">
                  Point to an existing project
                </span>
              </CardContent>
            </Card>

            <Card
              className={`gap-3 py-4 transition-colors ${
                hasGitHubToken
                  ? "cursor-pointer hover:bg-accent"
                  : "cursor-not-allowed opacity-50"
              }`}
              onClick={() => hasGitHubToken && setMode("github")}
            >
              <CardContent className="flex flex-col items-center gap-2 text-center">
                <Github className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">Clone from GitHub</span>
                <span className="text-xs text-muted-foreground">
                  {hasGitHubToken
                    ? "Clone a repository"
                    : "Requires GitHub token"}
                </span>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer gap-3 py-4 transition-colors hover:bg-accent"
              onClick={() => setMode("empty")}
            >
              <CardContent className="flex flex-col items-center gap-2 text-center">
                <Plus className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">New Empty Project</span>
                <span className="text-xs text-muted-foreground">
                  Start from scratch
                </span>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Folder mode */}
        {mode === "folder" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Directory Path</Label>
              <PathInput
                value={folderPath}
                onChange={setFolderPath}
                onValidation={handlePathValidation}
              />
            </div>
            <div className="space-y-2">
              <Label>Project Name</Label>
              <Input
                placeholder="Project name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate()
                }}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  creating ||
                  !projectName.trim() ||
                  !folderPath.trim() ||
                  folderHasError
                }
              >
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {creating ? "Creating..." : "Create Project"}
              </Button>
            </div>
          </div>
        )}

        {/* GitHub mode */}
        {mode === "github" && (
          <div className="space-y-4">
            {!selectedRepo ? (
              <GitHubRepoPicker
                onSelect={handleRepoSelect}
                disabled={!hasGitHubToken}
              />
            ) : (
              <div className="space-y-2">
                <Label>Selected Repository</Label>
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="font-medium">
                    {selectedOwner}/{selectedRepo}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedOwner("")
                      setSelectedRepo("")
                      setProjectName("")
                    }}
                  >
                    Change
                  </Button>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={creating || !selectedRepo}
              >
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {creating ? "Cloning..." : "Clone & Create"}
              </Button>
            </div>
          </div>
        )}

        {/* Empty mode */}
        {mode === "empty" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project Name</Label>
              <Input
                placeholder="Project name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate()
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>
                Project Location{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <PathInput
                value={emptyPath}
                onChange={setEmptyPath}
                onValidation={setEmptyPathValidation}
                placeholder="Leave empty to skip"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={handleBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  creating ||
                  !projectName.trim() ||
                  emptyPathHasError
                }
              >
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {creating ? "Creating..." : "Create Project"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
