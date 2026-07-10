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
      data-slot="preset-apply-pill"
      onClick={() => onApply(preset.id)}
      class="border-border text-muted-foreground hover:text-foreground hover:border-faint focus-visible:ring-ring/55 rounded-full border px-2.5 py-1 text-xs font-medium transition-[transform,color,border-color] duration-150 ease-out outline-none focus-visible:ring-2 active:scale-[0.96]"
    >
      {preset.name}
    </button>
  );
}
