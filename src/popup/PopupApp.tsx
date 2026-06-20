import { useEffect, useState } from "preact/hooks";

import { activeCriteriaCount } from "@/core/filter-projection";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import { detectPlatform, keycaps, type Platform } from "@/core/keycaps";
import { POPUP_ACTIVE, POPUP_ASLEEP } from "@/core/strings";
import { Badge, Button, Card, Kbd, LassoMark, Switch } from "@/ui/components";
import { FilterPanel } from "@/ui/filter-panel";
import { useSignalValue } from "@/ui/use-signal-value";

/** Discoverability for users who never press ? (story beat 9). */
export const TOP_SHORTCUTS: ReadonlyArray<{ combo: string; label: string }> = [
  { combo: "Alt+l", label: "File the author into a List" },
  { combo: "s", label: "Select many people" },
  { combo: "?", label: "Every shortcut" },
];

export type TabState = "active" | "asleep" | "off-x";

export interface PopupDeps {
  /** Resolve the active tab's Lasso state. */
  queryState(): Promise<TabState>;
  /** Wake a dormant tab (sends lasso-activate). */
  wake(): Promise<void>;
  openOptions(): void;
  platform?: Platform;
  /** Shared filter store, hydrated from storage.sync on mount; injectable for tests. */
  filter?: FilterStore;
}

const STATUS: Record<TabState | "loading", { dot: string; label: string }> = {
  active: { dot: "bg-success", label: "Active" },
  asleep: { dot: "bg-primary", label: "Asleep" },
  "off-x": { dot: "bg-faint", label: "Off X" },
  loading: { dot: "bg-border", label: "…" },
};

export function PopupApp({
  queryState,
  wake,
  openOptions,
  platform,
  filter = createFilterStore(),
}: PopupDeps) {
  const [state, setState] = useState<TabState | null>(null);
  const filterState = useSignalValue(filter.state);
  const plat = platform ?? detectPlatform();

  useEffect(() => {
    void queryState().then(setState);
  }, [queryState]);

  useEffect(() => {
    void filter.load();
  }, [filter]);

  const status = STATUS[state ?? "loading"];
  // Shared core projection (was an inline count that diverged from the funnel-pill
  // badge on a surviving "off" key — now one source of truth, ADR-deepening #3).
  const armed = activeCriteriaCount(filterState);
  const presetCount = filterState.presets.length;

  return (
    <main class="text-foreground flex w-[340px] flex-col gap-3 p-3.5">
      <Card class="gap-3 p-4 shadow-[var(--shadow-pop)]">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <LassoMark size={20} class="text-primary" />
            <span class="text-[16px] font-bold tracking-tight">Lasso</span>
          </div>
          <Badge variant="secondary" class="text-muted-foreground px-2.5 py-1">
            <span class={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </Badge>
        </div>

        <div class="flex items-end justify-between">
          <div class="flex flex-col">
            <span class="text-[28px] leading-none font-bold tabular-nums">{armed}</span>
            <span class="text-faint mt-1.5 text-[11px]">
              {armed === 1 ? "filter on" : "filters on"}
            </span>
          </div>
          <div class="flex flex-col items-end">
            <span class="text-primary text-[16px] leading-none font-semibold tabular-nums">
              {presetCount}
            </span>
            <span class="text-faint mt-1.5 text-[11px]">
              {presetCount === 1 ? "preset" : "presets"}
            </span>
          </div>
        </div>

        {state === "active" && <p class="text-muted-foreground text-[12px]">{POPUP_ACTIVE}</p>}
        {state === "asleep" && (
          <Button class="w-full" onClick={() => void wake().then(() => setState("active"))}>
            {POPUP_ASLEEP}
          </Button>
        )}
        {state === "off-x" && <p class="text-faint text-[12px]">Open x.com to use Lasso</p>}
      </Card>

      <FilterPanel store={filter} />

      <Card class="p-3.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex flex-col gap-0.5">
            <span class="text-[13px] font-medium">Hide filtered posts completely</span>
            <span class="text-faint text-[11px] leading-snug">
              Collapse filtered rows to nothing — off keeps the slim placeholders.
            </span>
          </div>
          <Switch
            label="Hide filtered posts completely"
            checked={filterState.compactHidden}
            onChange={(on) => filter.setCompactHidden(on)}
          />
        </div>
      </Card>

      <section class="flex flex-col gap-2 px-1">
        {TOP_SHORTCUTS.map((s) => (
          <div key={s.combo} class="flex items-center justify-between text-[13px]">
            <span class="text-muted-foreground">{s.label}</span>
            <span class="flex items-center gap-1">
              {keycaps(s.combo, plat).map((cap) => (
                <Kbd key={cap}>{cap}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </section>

      <Button
        variant="outline"
        class="hover:border-primary hover:text-primary w-full"
        onClick={openOptions}
      >
        All settings →
      </Button>
    </main>
  );
}
