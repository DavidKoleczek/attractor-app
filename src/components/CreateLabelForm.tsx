import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/LoadingSpinner";

const PRESET_COLORS = [
  "b60205", "d93f0b", "e99695", "f9d0c4",
  "0e8a16", "006b75", "0075ca", "1d76db",
  "5319e7", "7057ff", "d876e3", "fbca04",
  "e4e669", "bfdadc", "c2e0c6", "c5def5",
];

function randomPresetColor(): string {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
}

interface CreateLabelFormProps {
  onSubmit: (name: string, color: string, description?: string) => Promise<void>;
  onCancel: () => void;
}

export function CreateLabelForm({ onSubmit, onCancel }: CreateLabelFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(randomPresetColor);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedColor = color.replace(/^#/, "").trim();
    if (!trimmedName || !trimmedColor) return;

    setSaving(true);
    setError(null);
    try {
      await onSubmit(trimmedName, trimmedColor, description.trim() || undefined);
    } catch (err) {
      setError(typeof err === "string" ? err : "Failed to create label");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="space-y-2">
        <Input
          placeholder="Label name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={saving}
          autoFocus
          className="h-8 text-sm"
        />
        <Input
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={saving}
          className="h-8 text-sm"
        />
      </div>

      {/* Color swatches */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`size-5 rounded-full border-2 transition-all ${
                color === c
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-105"
              }`}
              style={{ backgroundColor: `#${c}` }}
              onClick={() => setColor(c)}
              title={`#${c}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block size-5 shrink-0 rounded-full border"
            style={{ backgroundColor: `#${color}` }}
          />
          <span className="text-xs text-muted-foreground">#</span>
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value.replace(/^#/, ""))}
            disabled={saving}
            className="h-7 w-24 font-mono text-xs"
            maxLength={6}
          />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={saving || !name.trim() || !color.trim()}
          className="h-7 text-xs"
        >
          {saving ? <LoadingSpinner size={12} /> : "Create label"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={saving}
          className="h-7 text-xs"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
