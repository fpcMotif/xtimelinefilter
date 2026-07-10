import { useEffect, useMemo, useState } from "preact/hooks";

import { activeCriteriaCount } from "@/core/filter-projection";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import { mirrorAgeLabel, type MirrorStatus } from "@/core/mirror-status";
import { POPUP_ACTIVE, POPUP_ASLEEP } from "@/core/strings";
import { Badge, Button, Card, LassoMark, PresetApplyPill, Switch } from "@/ui/components";
import { useSignalValue } from "@/ui/use-signal-value";

export type TabState = "active" | "asleep" | "off-x";

export interface PopupDeps {
  /** Resolve the active tab's Lasso state. */
  queryState(): Promise<TabState>;
  /** Wake a dormant tab (sends lasso-activate). */
  wake(): Promise<void>;
  openOptions(): void;
  /** Shared filter store, hydrated from storage.sync on mount; injectable for tests. */
  filter?: FilterStore;
  /** Last Mirror write outcome (storage.local); absent/null ⇒ no Mirror row. */
  mirrorStatus?(): Promise<MirrorStatus | null>;
  now?: () => number;
}

const STATUS: Record<TabState | "loading", { dot: string; label: string }> = {
  active: { dot: "bg-success", label: "Active" },
  asleep: { dot: "bg-primary", label: "Asleep" },
  "off-x": { dot: "bg-faint", label: "Off X" },
  loading: { dot: "bg-border", label: "…" },
};

/**
 * The toolbar popup: a compact *remote* (not the live filter console). It glances
 * the tab's Lasso state and active-filter count, then offers only the fast
 * controls — the master Filter and language gates, one-tap preset apply, and the
 * compact-hidden display switch — with a launcher into the full Options workshop.
 * The criteria chips themselves live where you can watch their effect: the
 * in-page funnel pill and the Options "Timeline filter" section.
 */
export function PopupApp({
  queryState,
  wake,
  openOptions,
  filter: filterProp,
  mirrorStatus,
  now,
}: PopupDeps) {
  // Create the store ONCE per mount — never as a parameter default. See
  // OptionsApp: a `createFilterStore()` default re-runs every render and spins
  // an infinite re-render loop through useSignalValue + the [filter] effect dep
  // (live-verified). Tests inject a stable store, so only the prop-less popup
  // entry mount looped.
  const filter = useMemo(() => filterProp ?? createFilterStore(), [filterProp]);
  const [state, setState] = useState<TabState | null>(null);
  const [mirror, setMirror] = useState<MirrorStatus | null>(null);
  const filterState = useSignalValue(filter.state);

  useEffect(() => {
    void queryState().then(setState);
  }, [queryState]);

  useEffect(() => {
    void filter.load();
  }, [filter]);

  useEffect(() => {
    void mirrorStatus?.().then((s) => setMirror(s));
  }, [mirrorStatus]);

  const status = STATUS[state ?? "loading"];
  // One shared core projection — the funnel-pill badge and this count once
  // diverged on a surviving "off" key.
  const armed = activeCriteriaCount(filterState);
  const presetCount = filterState.presets.length;

  return (
    <main class="text-foreground flex w-[320px] flex-col gap-2.5 p-3">
      <Card class="gap-3 p-3.5 shadow-[var(--shadow-pop)]">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <LassoMark size={20} class="text-primary" />
            <span class="text-[16px] font-bold tracking-tight">Lasso</span>
          </div>
          <Badge variant="secondary" class="text-muted-foreground px-2.5 py-1">
            <span class={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </Badge>
        </div>

        <div class="flex items-end gap-5">
          <div class="flex items-baseline gap-1.5">
            <span class="text-[26px] leading-none font-bold tabular-nums">{armed}</span>
            <span class="text-faint text-[11px]">{armed === 1 ? "filter on" : "filters on"}</span>
          </div>
          <div class="flex items-baseline gap-1.5">
            <span class="text-primary text-[16px] leading-none font-semibold tabular-nums">
              {presetCount}
            </span>
            <span class="text-faint text-[11px]">{presetCount === 1 ? "preset" : "presets"}</span>
          </div>
        </div>

        {mirror && (
          <p class="text-faint flex items-center gap-1.5 text-[12px]">
            <span class={`h-1.5 w-1.5 rounded-full ${mirror.ok ? "bg-success" : "bg-danger"}`} />
            {mirror.ok
              ? `Mirror synced ${mirrorAgeLabel(mirror.at, (now ?? Date.now)())}`
              : "Mirror failing — check Convex settings"}
          </p>
        )}

        {state === "active" && <p class="text-faint text-[12px]">{POPUP_ACTIVE}</p>}
        {state === "asleep" && (
          <Button class="w-full" onClick={() => void wake().then(() => setState("active"))}>
            {POPUP_ASLEEP}
          </Button>
        )}
        {state === "off-x" && <p class="text-faint text-[12px]">Open x.com to use Lasso</p>}
      </Card>

      <Card class="divide-border gap-0 divide-y p-0">
        <ToggleRow
          label="Timeline filter"
          checked={filterState.enabled}
          onChange={(on) => filter.setEnabled(on)}
        />
        <ToggleRow
          label="Only my languages"
          checked={filterState.onlyMyLanguages}
          onChange={(on) => filter.setOnlyMyLanguages(on)}
        />

        <div class="flex items-center gap-2 px-3.5 py-2.5">
          <span class="text-faint text-[10px] font-bold tracking-wider uppercase">Presets</span>
          {presetCount === 0 ? (
            <span class="text-faint text-[12px]">Save one from the funnel on x.com</span>
          ) : (
            <div class="flex flex-wrap gap-1.5">
              {filterState.presets.map((preset) => (
                <PresetApplyPill
                  key={preset.id}
                  preset={preset}
                  onApply={(id) => filter.applyPreset(id)}
                />
              ))}
            </div>
          )}
        </div>

        <div class="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <div class="flex flex-col">
            <span class="text-[13px] font-medium">Hide filtered posts</span>
            <span class="text-faint text-[11px]">Collapse filtered rows fully</span>
          </div>
          <Switch
            label="Hide filtered posts completely"
            checked={filterState.compactHidden}
            onChange={(on) => filter.setCompactHidden(on)}
          />
        </div>
      </Card>

      <div class="flex flex-col gap-1.5 px-0.5">
        <Button
          variant="outline"
          class="hover:border-primary hover:text-primary w-full"
          onClick={openOptions}
        >
          All settings
        </Button>
        <p class="text-faint text-center text-[11px]">Press ? on x.com for every shortcut</p>
      </div>
    </main>
  );
}

/** A single full-width popup row: a label on the left, a switch on the right. */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div class="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span class="text-[13px] font-medium">{label}</span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
