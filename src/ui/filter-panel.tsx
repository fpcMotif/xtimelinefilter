import { useState } from "preact/hooks";

import type { Conduct, FilterStore } from "@/core/filter-store";
import { Button, Input, PresetApplyPill, Switch } from "@/ui/components";
import { CriteriaMatrix } from "@/ui/criteria-matrix";
import { useSignalValue } from "@/ui/use-signal-value";

export interface FilterPanelProps {
  store: FilterStore;
  /** When provided, render the "N hidden · show all / hide all" toggle. Omit on surfaces with no live hidden count. */
  hiddenCount?: () => number;
  /**
   * Conduct in-page Filter *commands* (cycle a criterion, reveal/show-all) through
   * the controller's fail-open wall; preferences (master enable, languages, presets)
   * stay direct. Omit ⇒ commands run directly on the store.
   */
  conduct?: Conduct;
}

/**
 * The Filter's shared, placement-agnostic body for the in-page funnel pill: the
 * master toggle, the "only my languages" gate, an optional hidden-count line
 * with a persistent "show all" / "hide all" reveal toggle, the shared
 * <CriteriaMatrix> chips, and a presets row (apply + save only — rename/delete
 * live in Options). Positioning is the mount's job. No innerHTML of page data
 * (ADR-0003).
 */
export function FilterPanel({ store, hiddenCount, conduct }: FilterPanelProps) {
  // Commands route through the conductor's fail-open wall in-page; with no
  // conductor they run directly on the store.
  const cmd = conduct ?? ((run: (s: FilterStore) => void) => run(store));
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
        <span class="flex items-center gap-2 text-xs font-medium">
          <Switch
            label="Timeline filter enabled"
            checked={state.enabled}
            onChange={(on) => store.setEnabled(on)}
          />
          Filter
        </span>
        <span class="flex items-center gap-2 text-xs font-medium">
          <Switch
            label="Only my languages"
            checked={state.onlyMyLanguages}
            onChange={(on) => store.setOnlyMyLanguages(on)}
          />
          Languages
        </span>
        {hidden !== undefined && (
          <span class="text-muted-foreground ml-auto text-xs tabular-nums">
            {revealed ? (
              <>
                showing all
                <button
                  type="button"
                  onClick={() => cmd((s) => s.setRevealed(false))}
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
                    onClick={() => cmd((s) => s.setRevealed(true))}
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

      <CriteriaMatrix store={store} conduct={conduct} show={state.enabled} />

      <div class="border-border flex flex-wrap items-center gap-1.5 border-t pt-3">
        <span class="text-faint w-12 shrink-0 text-[10px] font-bold tracking-wider uppercase">
          Presets
        </span>
        {state.presets.map((preset) => (
          <PresetApplyPill
            key={preset.id}
            preset={preset}
            onApply={(id) => store.applyPreset(id)}
          />
        ))}
        <Input
          type="text"
          aria-label="Preset name"
          placeholder="Name…"
          value={draftName}
          onInput={(e) => setDraftName((e.currentTarget as HTMLInputElement).value)}
          class="ml-auto h-7 w-24 rounded-lg px-2 text-xs"
        />
        <Button size="sm" class="h-7 px-2.5 text-xs" onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
