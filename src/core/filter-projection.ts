import { CRITERIA } from "@/core/filter-criteria";
import type { FilterStore } from "@/core/filter-store";
import type { FilterMode, FilterState } from "@/core/filter-types";

/**
 * State-derived Filter projections: the read-side views every surface renders,
 * concentrated in one place so they cannot diverge. (The funnel-pill badge and
 * the popup "filters on" count once derived the active count two different ways —
 * the pill skipping "off" criteria, the popup counting every key — so a surviving
 * "off" key disagreed between them.) Distinct from the *static* filter-criteria.ts
 * catalog: these derive from a live {@link FilterState}. Pure and data-only
 * (ADR-0003) — every label is a static catalog string, never page data.
 */

/** Active-criteria count: criteria not set to "off" plus the language gate (spec §5). */
export function activeCriteriaCount(state: FilterState): number {
  let n = 0;
  for (const mode of Object.values(state.criteria)) {
    if (mode && mode !== "off") n += 1;
  }
  if (state.onlyMyLanguages) n += 1;
  return n;
}

/** A single executable row in the palette: a stable id, a display label, and an effect. */
export interface PaletteItem {
  id: string;
  label: string;
  run(store: FilterStore): void;
}

const MODE_VERB: Record<Exclude<FilterMode, "off">, string> = { only: "Only", hide: "Hide" };

/**
 * Pure item catalog for the current filter state: every criterion contributes an
 * "Only · …" and a "Hide · …" entry; each saved preset contributes an apply
 * entry; and the global actions (reveal "Show all hidden" / re-hide "Hide all",
 * plus Disable/Enable filter) round it out. Stable ids/labels so the list diffs
 * cleanly across renders.
 */
export function buildPaletteItems(state: FilterState): PaletteItem[] {
  const items: PaletteItem[] = [];

  for (const criterion of CRITERIA) {
    for (const mode of ["only", "hide"] as const) {
      items.push({
        id: `criterion:${criterion.id}:${mode}`,
        label: `${MODE_VERB[mode]} · ${criterion.short}`,
        run: (store) => store.setMode(criterion.id, mode),
      });
    }
  }

  for (const preset of state.presets) {
    items.push({
      id: `preset:${preset.id}`,
      label: `Apply preset · ${preset.name}`,
      run: (store) => store.applyPreset(preset.id),
    });
  }

  items.push(
    {
      // Peek: reveal hidden posts but keep the filter armed (≠ disable).
      id: "action:show-all",
      label: "Show all hidden",
      run: (store) => store.setRevealed(true),
    },
    {
      // End the peek: re-apply the filter so revealed posts collapse again.
      id: "action:hide-all",
      label: "Hide all (resume filtering)",
      run: (store) => store.setRevealed(false),
    },
    {
      id: "action:disable",
      label: "Disable filter",
      run: (store) => store.setEnabled(false),
    },
    {
      id: "action:enable",
      label: "Enable filter",
      run: (store) => store.setEnabled(true),
    },
  );

  return items;
}
