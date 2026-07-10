import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import { activeCriteriaCount } from "@/core/filter-projection";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import { mirrorAgeLabel, type MirrorStatus } from "@/core/mirror-status";
import { createSettings, type SettingsStore } from "@/core/settings";
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
  /** Settings store — read once for the high-contrast page attribute. */
  settings?: SettingsStore;
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
 * The toolbar popup: a compact *remote* (not the live filter console). The hero
 * row pairs the armed-criteria count with the master Filter switch — the number
 * and the control that governs it read as one unit. Below: the language gate,
 * one-tap preset apply (with a transient "Applied" acknowledgement), the
 * compact-hidden display switch, and a launcher into the full Options workshop.
 * The criteria chips themselves live where you can watch their effect: the
 * in-page funnel pill and the Options "Timeline filter" section.
 */
export function PopupApp({
  queryState,
  wake,
  openOptions,
  filter: filterProp,
  settings: settingsProp,
  mirrorStatus,
  now,
}: PopupDeps) {
  // Create the stores ONCE per mount — never as a parameter default. A
  // `create*()` default re-runs every render and spins an infinite re-render
  // loop through useSignalValue + the effect deps (live-verified; pinned by
  // tests/regression/store-stability.test.tsx).
  const filter = useMemo(() => filterProp ?? createFilterStore(), [filterProp]);
  const settings = useMemo(() => settingsProp ?? createSettings(), [settingsProp]);
  const [state, setState] = useState<TabState | null>(null);
  const [mirror, setMirror] = useState<MirrorStatus | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const filterState = useSignalValue(filter.state);

  useEffect(() => {
    void queryState().then(setState);
  }, [queryState]);

  useEffect(() => {
    void filter.load();
  }, [filter]);

  useEffect(() => {
    void settings.get().then((s) => {
      document.documentElement.toggleAttribute("data-hc", s.highContrast);
    });
  }, [settings]);

  useEffect(() => {
    void mirrorStatus?.().then((s) => setMirror(s));
  }, [mirrorStatus]);

  useEffect(() => {
    if (!applied) return;
    const timer = setTimeout(() => setApplied(null), 1600);
    return () => clearTimeout(timer);
  }, [applied]);

  const status = STATUS[state ?? "loading"];
  // One shared core projection — the funnel-pill badge and this count once
  // diverged on a surviving "off" key.
  const armed = activeCriteriaCount(filterState);
  const enabled = filterState.enabled;
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

        <label
          htmlFor="popup-master-filter"
          class="flex cursor-pointer items-center justify-between gap-3"
        >
          <span class="flex items-baseline gap-1.5">
            <span
              class={`text-[26px] leading-none font-bold tabular-nums transition-colors ${
                enabled ? "" : "text-faint"
              }`}
            >
              {armed}
            </span>
            <span class="text-faint text-2xs">
              {enabled ? (armed === 1 ? "filter armed" : "filters armed") : "filter off"}
            </span>
          </span>
          <Switch
            id="popup-master-filter"
            label="Timeline filter"
            checked={enabled}
            onChange={(on) => filter.setEnabled(on)}
          />
        </label>

        {mirror && (
          <button
            type="button"
            onClick={openOptions}
            class="text-faint hover:text-foreground focus-visible:ring-ring/55 -mx-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs transition-colors outline-none focus-visible:ring-2"
          >
            <span
              class={`h-1.5 w-1.5 rounded-full ${mirror.ok ? "bg-success" : "bg-destructive"}`}
            />
            {mirror.ok ? (
              `Mirror synced ${mirrorAgeLabel(mirror.at, (now ?? Date.now)())}`
            ) : (
              <span class="text-destructive">Mirror failing — open settings</span>
            )}
          </button>
        )}

        {state === "active" && <p class="text-faint text-xs">{POPUP_ACTIVE}</p>}
        {state === "asleep" && (
          <Button class="w-full" onClick={() => void wake().then(() => setState("active"))}>
            {POPUP_ASLEEP}
          </Button>
        )}
        {state === "off-x" && <p class="text-faint text-xs">Open x.com to use Lasso</p>}
      </Card>

      <Card class="divide-border gap-0 divide-y p-0">
        <ToggleRow
          label="Only my languages"
          checked={filterState.onlyMyLanguages}
          onChange={(on) => filter.setOnlyMyLanguages(on)}
        />

        <div class="flex items-center gap-2 px-3.5 py-2.5">
          <span class="text-faint text-[10px] font-bold tracking-wider uppercase">Presets</span>
          {applied && (
            <span aria-live="polite" class="text-success text-2xs font-medium">
              Applied · {applied}
            </span>
          )}
          {presetCount === 0 ? (
            <span class="text-faint text-xs">Save one from the funnel on x.com</span>
          ) : (
            <div class="flex flex-wrap gap-1.5">
              {filterState.presets.map((preset) => (
                <PresetApplyPill
                  key={preset.id}
                  preset={preset}
                  onApply={(id) => {
                    filter.applyPreset(id);
                    setApplied(preset.name);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <ToggleRow
          label="Hide filtered posts"
          hint="Collapse filtered rows fully"
          checked={filterState.compactHidden}
          onChange={(on) => filter.setCompactHidden(on)}
        />
      </Card>

      <div class="flex flex-col gap-1.5 px-0.5">
        <Button
          variant="outline"
          class="hover:border-primary hover:text-primary w-full"
          onClick={openOptions}
        >
          All settings
        </Button>
        <p class="text-faint text-2xs text-center">Press ? on x.com for every shortcut</p>
      </div>
    </main>
  );
}

/** A full-width popup row: label (and optional hint) left, switch right. The
    whole row is the <label>, so any tap toggles. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: ComponentChildren;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = `popup-${label.toLowerCase().replaceAll(/\W+/g, "-")}`;
  return (
    <label
      htmlFor={id}
      class="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5"
    >
      <span class="flex flex-col">
        <span class="text-compact font-medium">{label}</span>
        {hint && <span class="text-faint text-2xs">{hint}</span>}
      </span>
      <Switch id={id} label={label} checked={checked} onChange={onChange} />
    </label>
  );
}
