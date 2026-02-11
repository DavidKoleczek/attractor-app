import { useCallback, useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  ArrowLeft,
  Github,
  HardDrive,
  RefreshCw,
  Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { GitHubAuthSetup } from "@/components/GitHubAuthSetup"
import { ConnectGitHubDialog } from "@/components/ConnectGitHubDialog"
import { api } from "@/api"
import type { StoreStatus } from "@/types"

export default function ProjectSettings() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const projectName = name ? decodeURIComponent(name) : ""

  const [store, setStore] = useState<StoreStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [connectOpen, setConnectOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectName) return
    setLoading(true)
    setError(null)
    try {
      const st = await api.getStore(projectName)
      setStore(st)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project settings")
    } finally {
      setLoading(false)
    }
  }, [projectName])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleSync() {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const result = await api.syncStore(projectName)
      const parts: string[] = []
      if (result.pulled) parts.push("pulled")
      if (result.pushed) parts.push("pushed")
      setSyncMessage(parts.length > 0 ? `Sync complete (${parts.join(", ")})` : "Nothing to sync")
    } catch (err) {
      setSyncMessage(err instanceof Error ? err.message : "Sync failed")
    } finally {
      setSyncing(false)
    }
  }

  function handleConnected(newStore: StoreStatus) {
    setStore(newStore)
    fetchData()
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner label="Loading settings..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/project/${encodeURIComponent(projectName)}`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-bold">{projectName} Settings</h1>
      </div>

      {/* Store Configuration */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Store Configuration</h2>
        <div className="rounded-lg border p-4 space-y-4">
          {/* Current status */}
          <div className="flex items-center gap-2 text-sm">
            {store?.github ? (
              <>
                <Github className="h-4 w-4" />
                <span>
                  Connected to{" "}
                  <a
                    href={`https://github.com/${store.github.owner}/${store.github.repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                  >
                    {store.github.owner}/{store.github.repo}
                  </a>
                </span>
              </>
            ) : (
              <>
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Local only</span>
              </>
            )}
          </div>

          {/* Store ID */}
          <div className="text-xs text-muted-foreground">
            Store ID: <code className="rounded bg-muted px-1 py-0.5">{store?.store_id}</code>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {store?.github ? (
              <>
                <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
                  <RefreshCw className={`mr-2 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "Sync Now"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConnectOpen(true)}>
                  Change Store
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setConnectOpen(true)}>
                <Github className="mr-2 h-3.5 w-3.5" />
                Connect to GitHub
              </Button>
            )}
          </div>

          {syncMessage && (
            <p className="text-sm text-muted-foreground">{syncMessage}</p>
          )}
        </div>
      </section>

      <Separator className="my-8" />

      {/* GitHub Authentication */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">GitHub Authentication</h2>
        <div className="rounded-lg border p-4">
          <GitHubAuthSetup />
        </div>
      </section>

      {/* Connect Dialog */}
      <ConnectGitHubDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        projectName={projectName}
        onConnected={handleConnected}
      />
    </div>
  )
}
