import { cn } from "@/lib/utils";
import type { Label } from "@/types";

/**
 * Determine whether to use dark or light text on a given hex background.
 * Uses the W3C relative luminance formula.
 */
function contrastColor(hex: string): string {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.substring(0, 2), 16);
  const g = parseInt(raw.substring(2, 4), 16);
  const b = parseInt(raw.substring(4, 6), 16);
  // Perceived brightness (YIQ)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#000000" : "#ffffff";
}

interface LabelBadgeProps {
  label: Label;
  className?: string;
  onRemove?: () => void;
}

export function LabelBadge({ label, className, onRemove }: LabelBadgeProps) {
  const bg = `#${label.color}`;
  const fg = contrastColor(label.color);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium leading-tight",
        className,
      )}
      style={{ backgroundColor: bg, color: fg }}
      title={label.description ?? undefined}
    >
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 inline-flex items-center rounded-full p-0.5 hover:opacity-70"
          style={{ color: fg }}
          aria-label={`Remove label ${label.name}`}
        >
          <svg
            className="size-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
