import { signal, type ReadonlySignal } from "@preact/signals-core";

import type {
  CriterionId,
  FilterMode,
  FilterPreset,
  FilterState,
  LinkRule,
} from "@/core/filter-types";
import type { StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";
import { syncedStore } from "@/core/synced-store";

/** storage.sync key for the one global filter (v1). */
const KEY = STORAGE_KEYS.filter;

const NEXT_MODE: Record<FilterMode, FilterMode> = { off: "only", only: "hide", hide: "off" };

export interface FilterStore {
  /** Reactive filter configuration; consumers `.subscribe` or read `.value`. */
  readonly state: ReadonlySignal<FilterState>;
  /**
   * Transient "show all hidden" peek — un-collapses the timeline *without*
   * touching the persisted config (criteria + master toggle stay armed). Not
   * persisted and not synced; any selection edit resumes filtering. Distinct
   * from `enabled` so "show all" and "disable filter" are no longer the same act.
   */
  readonly revealed: ReadonlySignal<boolean>;
  /** Advance a criterion's tri-state off → only → hide → off. */
  cycle(id: CriterionId): void;
  /** Set a criterion directly ("off" clears it). */
  setMode(id: CriterionId, mode: FilterMode): void;
  setOnlyMyLanguages(on: boolean): void;
  setMyLanguages(langs: readonly string[]): void;
  setLinkRules(rules: LinkRule[]): void;
  setEnabled(on: boolean): void;
  /**
   * Persist the compact-hidden display mode: when true, filtered cells collapse
   * to 0 height (no stub). Synced like the rest of the config; not a peek.
   */
  setCompactHidden(on: boolean): void;
  /** Toggle the transient reveal (see {@link FilterStore.revealed}); a no-op while the filter is disabled. */
  setRevealed(on: boolean): void;
  /** Snapshot the active selection (criteria + language gate) as a named preset; returns its id. */
  savePreset(name: string): string;
  /** Replace criteria + onlyMyLanguages (+ myLanguages if captured); never touches linkRules. */
  applyPreset(id: string): void;
  renamePreset(id: string, name: string): void;
  deletePreset(id: string): void;
  /** Hydrate from storage.sync, merging over defaults. Never throws. */
  load(): Promise<void>;
  /** Replace the whole config in one shot (the conductor undoes a filter command by restoring a snapshot); persists + syncs. */
  restore(state: FilterState): void;
}

export interface FilterStoreDeps {
  storage?: StorageLike;
  navLanguages?: readonly string[];
}

/** "ja-JP" → "ja"; lowercased, trimmed, empties dropped, deduped (order-preserving). */
export function normalizeLangs(langs: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of langs) {
    const base = raw.split("-")[0]?.toLowerCase().trim();
    if (base && !out.includes(base)) out.push(base);
  }
  return out;
}

function defaultState(navLanguages: readonly string[]): FilterState {
  return {
    enabled: true,
    criteria: {},
    onlyMyLanguages: false,
    myLanguages: normalizeLangs(navLanguages),
    linkRules: [],
    presets: [],
    compactHidden: false,
  };
}

/**
 * Reactive, persisted store for the one global filter (storage.sync). A thin
 * reactive face over {@link syncedStore} (cache + merge + echo + listener); its
 * writes are wrapped fail-soft so a storage failure falls back to in-memory
 * defaults and never throws into the page (spec §8).
 */
export function createFilterStore(deps: FilterStoreDeps = {}): FilterStore {
  const area = deps.storage ?? (chrome.storage.sync as unknown as StorageLike);
  const navLanguages =
    deps.navLanguages ?? (typeof navigator !== "undefined" ? navigator.languages : []);
  const store = syncedStore<FilterState>(KEY, defaultState(navLanguages), area);
  const state = signal<FilterState>(store.current());
  const revealed = signal<boolean>(false);

  // Persist via syncedStore's strict write, wrapped fail-soft: a storage.sync
  // failure falls back to in-memory defaults and never throws into the page (§8).
  function persist(): void {
    void store.write(state.value).catch(() => {});
  }
  function update(patch: Partial<FilterState>): void {
    state.value = { ...state.value, ...patch };
    persist();
  }
  // Any change to the selection ends a "show all" peek — adjusting the filter
  // is the natural signal that the user wants to see its effect again.
  function resumeFiltering(): void {
    if (revealed.value) revealed.value = false;
  }
  function setMode(id: CriterionId, mode: FilterMode): void {
    resumeFiltering();
    const criteria = { ...state.value.criteria };
    if (mode === "off") delete criteria[id];
    else criteria[id] = mode;
    update({ criteria });
  }

  // Bridge cross-context writes (popup / Options / sibling tabs) into this
  // store's signal so an edit anywhere reaches every open surface live.
  store.onExternalChange((next) => {
    state.value = next; // external change — adopt without re-persisting
  });

  return {
    state,
    revealed,
    cycle: (id) => setMode(id, NEXT_MODE[state.value.criteria[id] ?? "off"]),
    setMode,
    setOnlyMyLanguages: (on) => {
      resumeFiltering();
      update({ onlyMyLanguages: on });
    },
    setMyLanguages: (langs) => {
      resumeFiltering();
      update({ myLanguages: normalizeLangs(langs) });
    },
    setLinkRules: (rules) => {
      resumeFiltering();
      update({ linkRules: rules });
    },
    setEnabled: (on) => {
      resumeFiltering();
      update({ enabled: on });
    },
    // A display preference, not a selection edit — it must NOT end a "show all"
    // peek, so it deliberately skips resumeFiltering().
    setCompactHidden: (on) => update({ compactHidden: on }),
    setRevealed: (on) => {
      // Reveal only makes sense while the filter is armed. Guarding here keeps the
      // store coherent so no surface can render "showing all" beside a disabled
      // filter (e.g. the palette running "disable filter" then "show all hidden").
      revealed.value = on && state.value.enabled;
    },
    savePreset(name) {
      const id = crypto.randomUUID();
      const { criteria, onlyMyLanguages, myLanguages } = state.value;
      const preset: FilterPreset = {
        id,
        name,
        criteria: { ...criteria },
        onlyMyLanguages,
        myLanguages: [...myLanguages],
      };
      update({ presets: [...state.value.presets, preset] });
      return id;
    },
    applyPreset(id) {
      const preset = state.value.presets.find((p) => p.id === id);
      if (!preset) return;
      resumeFiltering();
      const patch: Partial<FilterState> = {
        criteria: { ...preset.criteria },
        onlyMyLanguages: preset.onlyMyLanguages,
      };
      if (preset.myLanguages) patch.myLanguages = [...preset.myLanguages];
      update(patch);
    },
    renamePreset(id, name) {
      update({
        presets: state.value.presets.map((p) => (p.id === id ? { ...p, name } : p)),
      });
    },
    deletePreset(id) {
      update({ presets: state.value.presets.filter((p) => p.id !== id) });
    },
    async load() {
      await store.hydrate().catch(() => {}); // §8: storage failure keeps in-memory defaults
      state.value = store.current();
    },
    restore(next) {
      state.value = next;
      persist();
    },
  };
}
