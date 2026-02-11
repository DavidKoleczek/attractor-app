import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const PRESET_COLORS = [
  "b60205", "d93f0b", "e99695", "f9d0c4",
  "0e8a16", "006b75", "1d76db", "0075ca",
  "5319e7", "d876e3", "fbca04", "fef2c0",
  "c2e0c6", "bfdadc", "c5def5", "bfd4f2",
]

function randomPreset(): string {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
}

interface CreateLabelFormProps {
  onSubmit: (name: string, color: string, description?: string) => Promise<void>
  onCancel: () => void
}

export function CreateLabelForm({ onSubmit, onCancel }: CreateLabelFormProps) {
  const [name, setName] = useState("")
  const [color, setColor] = useState(randomPreset)
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      await onSubmit(name.trim(), color, description.trim() || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create label")
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === "Escape") {
      onCancel()
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-2">
        <Input
          placeholder="Label name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          autoFocus
        />
        <Input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
      </div>
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">Color</div>
        <div className="flex flex-wrap gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: `#${c}`,
                borderColor: c === color ? "#000" : "transparent",
              }}
              onClick={() => setColor(c)}
              disabled={loading}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div
            className="h-6 w-6 rounded-full border"
            style={{ backgroundColor: `#${color}` }}
          />
          <Input
            className="h-7 w-24 font-mono text-xs"
            value={color}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6)
              setColor(v)
            }}
            disabled={loading}
            maxLength={6}
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={loading || !name.trim()}>
          {loading ? "Creating..." : "Create label"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
