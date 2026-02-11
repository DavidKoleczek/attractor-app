import { useCallback, useEffect, useState } from "react"
import { ExternalLink, KeyRound, Trash2, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/api"
import type { GitHubStatus } from "@/types"

interface GitHubAuthSetupProps {
  onStatusChange?: (status: GitHubStatus) => void
}

export function GitHubAuthSetup({ onStatusChange }: GitHubAuthSetupProps) {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [showTokenInput, setShowTokenInput] = useState(false)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const s = await api.getGitHubStatus()
      setStatus(s)
      onStatusChange?.(s)
    } catch {
      setError("Failed to check GitHub status")
    } finally {
      setLoading(false)
    }
  }, [onStatusChange])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  async function handleSaveToken() {
    if (!token.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.setGitHubToken(token.trim())
      setToken("")
      setShowTokenInput(false)
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to validate token")
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveToken() {
    setRemoving(true)
    setError(null)
    try {
      await api.removeGitHubToken()
      setShowTokenInput(false)
      await fetchStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove token")
    } finally {
      setRemoving(false)
    }
  }

  async function handleOpenPatUrl() {
    try {
      const { url } = await api.getPatUrl()
      window.open(url, "_blank")
    } catch {
      setError("Failed to get PAT URL")
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Checking GitHub status...</p>
  }

  if (status?.configured) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-600" />
          <span>
            Connected as <span className="font-medium">{status.user}</span>
          </span>
        </div>
        {showTokenInput ? (
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="New GitHub Personal Access Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveToken()
                if (e.key === "Escape") {
                  setShowTokenInput(false)
                  setToken("")
                }
              }}
              disabled={saving}
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveToken} disabled={saving || !token.trim()}>
                {saving ? "Validating..." : "Update Token"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowTokenInput(false)
                  setToken("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowTokenInput(true)}>
              <KeyRound className="mr-2 h-3.5 w-3.5" />
              Change Token
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRemoveToken}
              disabled={removing}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {removing ? "Removing..." : "Remove Token"}
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="h-4 w-4" />
        <span>No GitHub token configured</span>
      </div>
      <p className="text-sm text-muted-foreground">
        A Personal Access Token (PAT) is needed to connect your store to GitHub.
      </p>
      <div className="space-y-2">
        <Button size="sm" variant="outline" onClick={handleOpenPatUrl}>
          <ExternalLink className="mr-2 h-3.5 w-3.5" />
          Create a Token on GitHub
        </Button>
        <Input
          type="password"
          placeholder="Paste your GitHub Personal Access Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveToken()
          }}
          disabled={saving}
        />
        <Button size="sm" onClick={handleSaveToken} disabled={saving || !token.trim()}>
          {saving ? "Validating..." : "Save Token"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
