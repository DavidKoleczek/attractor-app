import { useCallback, useEffect, useState } from "react"
import { ExternalLink, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { api } from "@/api"
import type { GitHubStatus, AppConfig } from "@/types"

export function GitHubSetupBanner() {
  const [ghStatus, setGhStatus] = useState<GitHubStatus | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)

  const [token, setToken] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [gh, cfg] = await Promise.all([
        api.getGitHubStatus(),
        api.getConfig(),
      ])
      setGhStatus(gh)
      setConfig(cfg)
    } catch {
      // Silently fail - banner is non-critical
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleSaveToken() {
    if (!token.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.setGitHubToken(token.trim())
      setToken("")
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to validate token")
    } finally {
      setSaving(false)
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

  async function handleDismiss() {
    try {
      const cfg = await api.updateConfig({ pat_banner_dismissed: true })
      setConfig(cfg)
    } catch {
      // Silently fail
    }
  }

  if (loading || !ghStatus || !config) return null

  // Connected: show compact status
  if (ghStatus.configured) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-green-500" />
        <span>
          Connected as <span className="font-medium">{ghStatus.user}</span>
        </span>
      </div>
    )
  }

  // Dismissed: show subtle status
  if (config.pat_banner_dismissed) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
        <span>GitHub: not configured</span>
      </div>
    )
  }

  // Not configured, not dismissed: show prominent banner
  return (
    <Card className="mb-6">
      <CardContent className="space-y-3">
        <p className="text-sm">
          Connect your GitHub account to sync issues across devices.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleOpenPatUrl}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            Set up GitHub token
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDismiss}
          >
            Skip
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            placeholder="Paste your GitHub Personal Access Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveToken()
            }}
            disabled={saving}
            className="max-w-sm"
          />
          <Button
            size="sm"
            onClick={handleSaveToken}
            disabled={saving || !token.trim()}
          >
            <Check className="mr-2 h-3.5 w-3.5" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
