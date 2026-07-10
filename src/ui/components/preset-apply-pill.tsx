import type { FilterPreset } from "@/core/filter-types";

export interface PresetApplyPillProps {
  preset: FilterPreset;
  onApply: (id: string) => void;
}

/**
 * One saved preset rendered as a tap-to-apply chip — the single apply control
 * shared by the in-page <FilterPanel> and the toolbar popup, so the pill styling
 * lives in one place. Each surface wires its own store through {@link onApply}.
 */
export function PresetApplyPill({ preset, onApply }: PresetApplyPillProps) {
  return (
    <button
      type="button"
      onClick={() => onApply(preset.id)}
      class="border-border text-muted-foreground hover:text-foreground hover:border-faint rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors"
    >
      {preset.name}
    </button>
  );
}
