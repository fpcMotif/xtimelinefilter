import { signal, type ReadonlySignal } from "@preact/signals-core";

import type {
  CriterionId,
  FilterMode,
  FilterPreset,
  FilterState,
  LinkRule,
} from "@/core/filter-types";
import type { StorageLike } from "@/core/settings";

/** storage.sync key for the one global filter (v1). */
const KEY = "lasso:filter";

const NEXT_MODE: Record<FilterMode, FilterMode> = { off: "only", only: "hide", hide: "off" };

export interface FilterStore {
  /** Reactive filter configuration; consumers `.subscribe` or read `.value`. */
  readonly state: ReadonlySignal<FilterState>;
  /** Advance a criterion's tri-state off → only → hide → off. */
  cycle(id: CriterionId): void;
  /** Set a criterion directly ("off" clears it). */
  setMode(id: CriterionId, mode: FilterMode): void;
  setOnlyMyLanguages(on: boolean): void;
  setMyLanguages(langs: readonly string[]): void;
  setLinkRules(rules: LinkRule[]): void;
  setEnabled(on: boolean): void;
  /** Snapshot the active selection (criteria + language gate) as a named preset; returns its id. */
  savePreset(name: string): string;
  /** Replace criteria + onlyMyLanguages (+ myLanguages if captured); never touches linkRules. */
  applyPreset(id: string): void;
  renamePreset(id: string, name: string): void;
  deletePreset(id: string): void;
  /** Hydrate from storage.sync, merging over defaults. Never throws. */
  load(): Promise<void>;
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
  };
}

/**
 * Reactive, persisted store for the one global filter (storage.sync). Mirrors the
 * createSettings pattern; storage access is guarded so failures fall back to
 * in-memory defaults and never throw into the page (spec §8).
 */
export function createFilterStore(deps: FilterStoreDeps = {}): FilterStore {
  const area = deps.storage ?? (chrome.storage.sync as unknown as StorageLike);
  const navLanguages =
    deps.navLanguages ?? (typeof navigator !== "undefined" ? navigator.languages : []);
  const state = signal<FilterState>(defaultState(navLanguages));

  function persist(): void {
    Promise.resolve(area.set({ [KEY]: state.value })).catch(() => {});
  }
  function update(patch: Partial<FilterState>): void {
    state.value = { ...state.value, ...patch };
    persist();
  }
  function setMode(id: CriterionId, mode: FilterMode): void {
    const criteria = { ...state.value.criteria };
    if (mode === "off") delete criteria[id];
    else criteria[id] = mode;
    update({ criteria });
  }

  return {
    state,
    cycle: (id) => setMode(id, NEXT_MODE[state.value.criteria[id] ?? "off"]),
    setMode,
    setOnlyMyLanguages: (on) => update({ onlyMyLanguages: on }),
    setMyLanguages: (langs) => update({ myLanguages: normalizeLangs(langs) }),
    setLinkRules: (rules) => update({ linkRules: rules }),
    setEnabled: (on) => update({ enabled: on }),
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
      try {
        const raw = (await area.get(KEY))[KEY] as Partial<FilterState> | undefined;
        if (raw) state.value = { ...defaultState(navLanguages), ...raw };
      } catch {
        // keep safe in-memory defaults
      }
    },
  };
}
