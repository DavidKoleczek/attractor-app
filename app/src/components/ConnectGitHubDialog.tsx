import { useState } from "react"
import { ExternalLink } from "lucide-react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/api"
import type { StoreStatus } from "@/types"

interface ConnectGitHubDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  onConnected: (store: StoreStatus) => void
}

export function ConnectGitHubDialog({
  open,
  onOpenChange,
  projectName,
  onConnected,
}: ConnectGitHubDialogProps) {
  // Existing repo tab
  const [owner, setOwner] = useState("")
  const [repo, setRepo] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  // Create new repo tab
  const [repoName, setRepoName] = useState(`attractor-store-${projectName}`)
  const [isPrivate, setIsPrivate] = useState(true)
  const [description, setDescription] = useState(`Issues store for ${projectName}`)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createForbidden, setCreateForbidden] = useState<{
    create_url: string
    instructions: string
  } | null>(null)

  const [activeTab, setActiveTab] = useState("existing")

  function resetState() {
    setOwner("")
    setRepo("")
    setConnecting(false)
    setConnectError(null)
    setRepoName(`attractor-store-${projectName}`)
    setIsPrivate(true)
    setDescription(`Issues store for ${projectName}`)
    setCreating(false)
    setCreateError(null)
    setCreateForbidden(null)
    setActiveTab("existing")
  }

  async function handleConnect() {
    if (!owner.trim() || !repo.trim()) return
    setConnecting(true)
    setConnectError(null)
    try {
      const store = await api.connectStore(projectName, owner.trim(), repo.trim())
      onConnected(store)
      onOpenChange(false)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to connect")
    } finally {
      setConnecting(false)
    }
  }

  async function handleCreate() {
    if (!repoName.trim()) return
    setCreating(true)
    setCreateError(null)
    setCreateForbidden(null)
    try {
      const store = await api.createRemote(
        projectName,
        repoName.trim(),
        isPrivate,
        description.trim(),
      )
      onConnected(store)
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create repository"
      // Try to parse structured error from FastAPI's {"detail": {...}} envelope
      try {
        const parsed = JSON.parse(message)
        const detail = parsed.detail ?? parsed
        const inner = typeof detail === "string" ? JSON.parse(detail) : detail
        if (inner.error === "REPO_CREATE_FORBIDDEN") {
          setCreateForbidden({
            create_url: inner.create_url,
            instructions: inner.instructions,
          })
          return
        }
      } catch {
        // Not a structured error
      }
      setCreateError(message)
    } finally {
      setCreating(false)
    }
  }

  function handleForbiddenContinue() {
    setActiveTab("existing")
    setOwner("")
    setRepo(repoName.trim())
    setCreateForbidden(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) resetState()
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect to GitHub</DialogTitle>
          <DialogDescription>
            Back your issues store with a GitHub repository for sync and collaboration.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="existing" className="flex-1">
              Use Existing Repo
            </TabsTrigger>
            <TabsTrigger value="create" className="flex-1">
              Create New Repo
            </TabsTrigger>
          </TabsList>

          <TabsContent value="existing" className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Owner</Label>
              <Input
                placeholder="github-username"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                disabled={connecting}
              />
            </div>
            <div className="space-y-2">
              <Label>Repository</Label>
              <Input
                placeholder="repo-name"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnect()
                }}
                disabled={connecting}
              />
            </div>
            {connectError && <p className="text-sm text-destructive">{connectError}</p>}
            <Button
              onClick={handleConnect}
              disabled={connecting || !owner.trim() || !repo.trim()}
              className="w-full"
            >
              {connecting ? "Connecting..." : "Connect"}
            </Button>
          </TabsContent>

          <TabsContent value="create" className="space-y-4 pt-2">
            {createForbidden ? (
              <div className="space-y-3">
                <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                  <p className="font-medium">Token lacks admin permission</p>
                  <p className="mt-1 text-muted-foreground">
                    {createForbidden.instructions}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => window.open(createForbidden.create_url, "_blank")}
                  >
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />
                    Create on GitHub
                  </Button>
                  <Button onClick={handleForbiddenContinue}>
                    I've Created It
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Repository Name</Label>
                  <Input
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    disabled={creating}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    placeholder="Optional description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={creating}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isPrivate}
                    onClick={() => setIsPrivate(!isPrivate)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      isPrivate ? "bg-primary" : "bg-input"
                    }`}
                    disabled={creating}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-background shadow transition-transform ${
                        isPrivate ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-sm">{isPrivate ? "Private" : "Public"}</span>
                </div>
                {createError && <p className="text-sm text-destructive">{createError}</p>}
                <Button
                  onClick={handleCreate}
                  disabled={creating || !repoName.trim()}
                  className="w-full"
                >
                  {creating ? "Creating..." : "Create & Connect"}
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
