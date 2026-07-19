import { signal, type ReadonlySignal } from "@preact/signals-core";

import { CRITERIA_BY_ID, LINK_DEST_LABELS } from "@/core/filter-criteria";
import type {
  CriterionId,
  FilterMode,
  FilterPreset,
  FilterState,
  LinkDest,
  LinkRule,
} from "@/core/filter-types";
import { syncArea, type StorageLike } from "@/core/storage-areas";
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
  /** Stop the storage listener. Safe to call more than once. */
  dispose(): void;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCriteria(raw: unknown): Record<CriterionId, FilterMode> {
  if (!isRecord(raw)) return {};
  const criteria: Record<CriterionId, FilterMode> = {};
  for (const [id, mode] of Object.entries(raw)) {
    if (CRITERIA_BY_ID.has(id) && (mode === "only" || mode === "hide")) criteria[id] = mode;
  }
  return criteria;
}

function normalizeLanguages(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  return normalizeLangs(raw.filter((language): language is string => typeof language === "string"));
}

function normalizeLinkRules(raw: unknown): LinkRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((rule) => {
    if (
      !isRecord(rule) ||
      typeof rule.host !== "string" ||
      typeof rule.dest !== "string" ||
      !Object.hasOwn(LINK_DEST_LABELS, rule.dest)
    )
      return [];
    return [{ host: rule.host, dest: rule.dest as LinkDest }];
  });
}

function normalizePresets(raw: unknown): FilterPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((preset) => {
    if (
      !isRecord(preset) ||
      typeof preset.id !== "string" ||
      typeof preset.name !== "string" ||
      typeof preset.onlyMyLanguages !== "boolean" ||
      !isRecord(preset.criteria) ||
      (preset.myLanguages !== undefined && !Array.isArray(preset.myLanguages))
    )
      return [];
    const next: FilterPreset = {
      id: preset.id,
      name: preset.name,
      criteria: normalizeCriteria(preset.criteria),
      onlyMyLanguages: preset.onlyMyLanguages,
    };
    if (preset.myLanguages !== undefined)
      next.myLanguages = normalizeLanguages(preset.myLanguages, []);
    return [next];
  });
}

/**
 * Decode persisted Filter state at every storage boundary. Unknown fields and
 * invalid nested records never reach reactive consumers or the filter engine.
 */
export function normalizeFilterState(raw: unknown, defaults: FilterState): FilterState {
  const value = isRecord(raw) ? raw : {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    criteria: normalizeCriteria(value.criteria),
    onlyMyLanguages:
      typeof value.onlyMyLanguages === "boolean" ? value.onlyMyLanguages : defaults.onlyMyLanguages,
    myLanguages: normalizeLanguages(value.myLanguages, defaults.myLanguages),
    linkRules: normalizeLinkRules(value.linkRules),
    presets: normalizePresets(value.presets),
    compactHidden:
      typeof value.compactHidden === "boolean" ? value.compactHidden : defaults.compactHidden,
  };
}

function selectionChanged(a: FilterState, b: FilterState): boolean {
  if (a.enabled !== b.enabled || a.onlyMyLanguages !== b.onlyMyLanguages) return true;
  const aCriteria = Object.entries(a.criteria);
  const bCriteria = Object.entries(b.criteria);
  if (
    aCriteria.length !== bCriteria.length ||
    aCriteria.some(([id, mode]) => b.criteria[id as CriterionId] !== mode)
  )
    return true;
  if (
    a.myLanguages.length !== b.myLanguages.length ||
    a.myLanguages.some((language, index) => b.myLanguages[index] !== language)
  )
    return true;
  return (
    a.linkRules.length !== b.linkRules.length ||
    a.linkRules.some(
      (rule, index) =>
        b.linkRules[index]?.host !== rule.host || b.linkRules[index]?.dest !== rule.dest,
    )
  );
}

/**
 * Reactive, persisted store for the one global filter (storage.sync). A thin
 * reactive face over {@link syncedStore} (cache + merge + echo + listener); its
 * writes are wrapped fail-soft so a storage failure restores confirmed cache
 * authority and never throws into the page (spec §8).
 */
export function createFilterStore(deps: FilterStoreDeps = {}): FilterStore {
  const area = deps.storage ?? syncArea();
  const navLanguages =
    deps.navLanguages ?? (typeof navigator !== "undefined" ? navigator.languages : []);
  const defaults = defaultState(navLanguages);
  const store = syncedStore<FilterState>(KEY, defaults, area);
  const normalize = (raw: unknown): FilterState => normalizeFilterState(raw, defaults);
  const state = signal<FilterState>(normalize(store.current()));
  const revealed = signal<boolean>(false);

  // Persist via syncedStore's strict write, wrapped fail-soft: a storage.sync
  // failure restores confirmed authority and never throws into the page (§8).
  function persist(snapshot: FilterState): void {
    void store.write(snapshot).then(
      () => {
        // An external change may have displaced this queued optimistic snapshot.
        // If its own ordered write later confirms, restore only that exact cache.
        if (store.current() === snapshot && state.value !== snapshot)
          state.value = normalize(store.current());
      },
      () => {
        // syncedStore restores its cache on a failed write. Restore this reactive
        // face too, but only if this exact optimistic snapshot is still current:
        // a later successful write must win over an older rejection.
        if (state.value === snapshot) state.value = normalize(store.current());
      },
    );
  }
  function update(patch: Partial<FilterState>): void {
    const snapshot = { ...state.value, ...patch };
    state.value = snapshot;
    persist(snapshot);
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
  const stopExternalChanges = store.onExternalChange((raw) => {
    const next = normalize(raw);
    if (selectionChanged(state.value, next)) resumeFiltering();
    state.value = next; // external change — adopt without re-persisting
  });
  let disposed = false;

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
      state.value = normalize(store.current());
    },
    restore(next) {
      // Undo is a selection edit like any other: it must end a "show all" peek,
      // or Z reverts the config while the timeline visibly changes nothing.
      resumeFiltering();
      const normalized = normalize(next);
      state.value = normalized;
      persist(normalized);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopExternalChanges();
    },
  };
}
