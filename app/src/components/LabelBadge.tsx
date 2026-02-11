import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Label } from "@/types"

function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 128 ? "#000" : "#fff"
}

interface LabelBadgeProps {
  label: Label
  className?: string
  onRemove?: () => void
}

export function LabelBadge({ label, className, onRemove }: LabelBadgeProps) {
  const bg = `#${label.color}`
  const fg = contrastColor(label.color)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      style={{ backgroundColor: bg, color: fg }}
    >
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 rounded-full p-0.5 hover:opacity-70"
          style={{ color: fg }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}
