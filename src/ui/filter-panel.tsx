import { useState } from "preact/hooks";

import { CRITERIA_GROUPS } from "@/core/filter-criteria";
import type { FilterStore } from "@/core/filter-store";
import type { FilterMode } from "@/core/filter-types";
import { Button, Input, Switch } from "@/ui/components";
import { useSignalValue } from "@/ui/use-signal-value";

const CHIP_BASE =
  "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.96]";
const CHIP_BY_MODE: Record<FilterMode, string> = {
  off: "border-border text-muted-foreground hover:text-foreground hover:border-faint",
  only: "border-primary bg-primary text-primary-foreground shadow-sm",
  hide: "border-destructive/50 text-destructive line-through",
};

export interface FilterPanelProps {
  store: FilterStore;
  /** When provided, render the "N hidden · show all / hide all" toggle. Omit for surfaces with no live count (popup). */
  hiddenCount?: () => number;
}

/**
 * The Filter's shared, placement-agnostic body: family-grouped tri-state chips, a
 * legend, the master toggle, the single "only my languages" gate, an optional
 * hidden-count line with a persistent "show all" / "hide all" reveal toggle, and
 * a presets row (apply + save only — rename/delete live in Options). Every
 * surface (popover, popup) hosts this; positioning is the mount's
 * job. No innerHTML of page data (ADR-0003).
 */
export function FilterPanel({ store, hiddenCount }: FilterPanelProps) {
  const state = useSignalValue(store.state);
  const revealed = useSignalValue(store.revealed);
  const [draftName, setDraftName] = useState("");
  const hidden = hiddenCount?.();

  function onSave() {
    const name = draftName.trim();
    if (!name) return;
    store.savePreset(name);
    setDraftName("");
  }

  return (
    <div class="bg-card text-card-foreground border-border flex flex-col gap-3 rounded-2xl border p-3.5 text-sm">
      <div class="flex items-center gap-4">
        <span class="flex items-center gap-2 text-[12px] font-medium">
          <Switch
            label="Timeline filter enabled"
            checked={state.enabled}
            onChange={(on) => store.setEnabled(on)}
          />
          Filter
        </span>
        <span class="flex items-center gap-2 text-[12px] font-medium">
          <Switch
            label="Only my languages"
            checked={state.onlyMyLanguages}
            onChange={(on) => store.setOnlyMyLanguages(on)}
          />
          Languages
        </span>
        {hidden !== undefined && (
          <span class="text-muted-foreground ml-auto text-[12px] tabular-nums">
            {revealed ? (
              <>
                showing all
                <button
                  type="button"
                  onClick={() => store.setRevealed(false)}
                  class="text-primary ml-2 font-semibold underline-offset-2 hover:underline"
                >
                  hide all
                </button>
              </>
            ) : (
              <>
                {hidden} hidden
                {state.enabled && (
                  <button
                    type="button"
                    onClick={() => store.setRevealed(true)}
                    class="text-primary ml-2 font-semibold underline-offset-2 hover:underline"
                  >
                    show all
                  </button>
                )}
              </>
            )}
          </span>
        )}
      </div>

      <span class="text-faint text-[11px] tracking-wide">◯ off · ◉ only · ⊘ hide</span>

      {state.enabled &&
        CRITERIA_GROUPS.map(({ group, criteria }) => (
          <div key={group} class="flex flex-wrap items-center gap-1.5">
            <span class="text-faint w-12 shrink-0 text-[10px] font-bold tracking-wider uppercase">
              {group}
            </span>
            {criteria.map((chip) => {
              const mode: FilterMode = state.criteria[chip.id] ?? "off";
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-label={chip.label}
                  title={mode === "off" ? chip.label : `${chip.label}: ${mode}`}
                  data-mode={mode}
                  onClick={() => store.cycle(chip.id)}
                  class={`${CHIP_BASE} ${CHIP_BY_MODE[mode]}`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        ))}

      <div class="border-border flex flex-wrap items-center gap-1.5 border-t pt-3">
        <span class="text-faint w-12 shrink-0 text-[10px] font-bold tracking-wider uppercase">
          Presets
        </span>
        {state.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => store.applyPreset(preset.id)}
            class="border-border text-muted-foreground hover:text-foreground hover:border-faint rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors"
          >
            {preset.name}
          </button>
        ))}
        <Input
          type="text"
          aria-label="Preset name"
          placeholder="Name…"
          value={draftName}
          onInput={(e) => setDraftName((e.currentTarget as HTMLInputElement).value)}
          class="ml-auto h-7 w-24 rounded-lg px-2 text-[12px]"
        />
        <Button size="sm" class="h-7 px-2.5 text-[12px]" onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
