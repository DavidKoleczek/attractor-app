import { useEffect, useRef, useState } from "react"
import {
  Info,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { api } from "@/api"
import type { PathValidationResponse } from "@/types"

interface PathInputProps {
  value: string
  onChange: (value: string) => void
  onValidation?: (result: PathValidationResponse | null) => void
  placeholder?: string
}

const statusConfig: Record<
  PathValidationResponse["status"],
  { icon: "info" | "success" | "error"; message: string }
> = {
  not_found: { icon: "info", message: "Directory will be created" },
  empty: { icon: "success", message: "Empty directory" },
  has_content: { icon: "success", message: "Existing project directory" },
  git_repo: { icon: "success", message: "Git repository" },
  already_registered: {
    icon: "error",
    message: "Already tracked by project",
  },
  not_a_directory: { icon: "error", message: "Path is not a directory" },
  permission_denied: { icon: "error", message: "Permission denied" },
}

export function PathInput({
  value,
  onChange,
  onValidation,
  placeholder = "/path/to/project",
}: PathInputProps) {
  const [validating, setValidating] = useState(false)
  const [result, setResult] = useState<PathValidationResponse | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef(0)

  useEffect(() => {
    // Clear previous timer
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!value.trim()) {
      setResult(null)
      onValidation?.(null)
      return
    }

    setValidating(true)
    const id = ++abortRef.current

    timerRef.current = setTimeout(async () => {
      try {
        const res = await api.validatePath(value.trim())
        // Only apply if this is still the latest request
        if (id === abortRef.current) {
          setResult(res)
          onValidation?.(res)
        }
      } catch {
        if (id === abortRef.current) {
          setResult(null)
          onValidation?.(null)
        }
      } finally {
        if (id === abortRef.current) {
          setValidating(false)
        }
      }
    }, 500)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // onValidation intentionally excluded to avoid re-triggering on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const cfg = result ? statusConfig[result.status] : null

  return (
    <div className="space-y-1.5">
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {validating && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Validating...</span>
        </div>
      )}
      {!validating && cfg && (
        <div
          className={`flex items-center gap-1.5 text-xs ${
            cfg.icon === "success"
              ? "text-green-600"
              : cfg.icon === "error"
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
        >
          {cfg.icon === "success" && <CheckCircle2 className="h-3 w-3" />}
          {cfg.icon === "error" && <XCircle className="h-3 w-3" />}
          {cfg.icon === "info" && <Info className="h-3 w-3" />}
          <span>
            {cfg.message}
            {result?.status === "already_registered" && result.project_name
              ? ` "${result.project_name}"`
              : ""}
          </span>
        </div>
      )}
    </div>
  )
}
