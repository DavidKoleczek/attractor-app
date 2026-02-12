import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Lock, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/api"
import type { GitHubRepo } from "@/types"

interface GitHubRepoPickerProps {
  onSelect: (owner: string, repo: string) => void
  disabled?: boolean
}

export function GitHubRepoPicker({ onSelect, disabled }: GitHubRepoPickerProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef(0)

  const fetchRepos = useCallback(async (q?: string) => {
    const id = ++abortRef.current
    setLoading(true)
    setError(null)
    try {
      const list = await api.listRepos(q || undefined)
      if (id === abortRef.current) {
        setRepos(list)
      }
    } catch {
      if (id === abortRef.current) {
        setError("Failed to load repositories")
        setRepos([])
      }
    } finally {
      if (id === abortRef.current) {
        setLoading(false)
      }
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    if (!disabled) fetchRepos()
  }, [disabled, fetchRepos])

  // Debounced search (skip empty query — initial fetch handles that)
  useEffect(() => {
    if (disabled || !query) return
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      fetchRepos(query)
    }, 400)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, disabled, fetchRepos])

  if (disabled) {
    return (
      <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Set up a GitHub token to clone repositories
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search repositories..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ScrollArea className="h-56 rounded-md border">
        {loading && repos.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && repos.length === 0 && !error && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No repositories found
          </p>
        )}

        {repos.length > 0 && (
          <div className="divide-y">
            {repos.map((repo) => (
              <button
                key={repo.full_name}
                type="button"
                onClick={() => onSelect(repo.owner, repo.name)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {repo.full_name}
                    </span>
                    {repo.private && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        <Lock className="mr-0.5 h-2.5 w-2.5" />
                        Private
                      </Badge>
                    )}
                  </div>
                  {repo.description && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {repo.description}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
