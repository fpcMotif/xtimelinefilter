import { signal, type ReadonlySignal } from "@preact/signals-core";

import {
  applyFilterCommand,
  defaultFilterState,
  normalizeFilterState,
  normalizeLangs,
  selectionChanged,
  type FilterCommand,
} from "@/core/filter-domain";
import type { CriterionId, FilterMode, FilterState, LinkRule } from "@/core/filter-types";
import { requestFilterCommand, requestFilterRead } from "@/core/protocol";
import { syncArea, type StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";
import { watchStorageKey } from "@/core/storage-sync";
import { syncedStore } from "@/core/synced-store";

export { normalizeFilterState, normalizeLangs } from "@/core/filter-domain";

const KEY = STORAGE_KEYS.filter;

export interface FilterStore {
  readonly state: ReadonlySignal<FilterState>;
  /** Transient "show all hidden" peek. It is never persisted or synced. */
  readonly revealed: ReadonlySignal<boolean>;
  cycle(id: CriterionId): void;
  setMode(id: CriterionId, mode: FilterMode): void;
  setOnlyMyLanguages(on: boolean): void;
  setMyLanguages(langs: readonly string[]): void;
  setLinkRules(rules: LinkRule[]): void;
  setEnabled(on: boolean): void;
  setCompactHidden(on: boolean): void;
  setRevealed(on: boolean): void;
  savePreset(name: string): string;
  applyPreset(id: string): void;
  renamePreset(id: string, name: string): void;
  deletePreset(id: string): void;
  load(): Promise<void>;
  /** Intentional full replacement used by the conductor's one-entry undo. */
  restore(state: FilterState): void;
  dispose(): void;
}

export interface FilterStoreDeps {
  /** Test/non-extension authority. Production uses the worker command protocol. */
  storage?: StorageLike;
  navLanguages?: readonly string[];
}

const hasWorkerTransport = (): boolean =>
  typeof globalThis.chrome?.runtime?.sendMessage === "function";

const resumesFiltering = (
  command: FilterCommand,
  before: FilterState,
  after: FilterState,
): boolean => {
  switch (command.type) {
    case "cycle":
    case "set-mode":
    case "set-only-my-languages":
    case "set-my-languages":
    case "set-link-rules":
    case "set-enabled":
    case "restore":
      return true;
    case "apply-preset":
      return before !== after;
    case "set-compact-hidden":
    case "save-preset":
    case "rename-preset":
    case "delete-preset":
      return false;
  }
};

/**
 * Reactive Filter facade. In an extension, the worker serializes semantic
 * commands against current storage authority. Injected storage retains the
 * synchronous, direct adapter used by unit tests and non-extension hosts.
 */
export function createFilterStore(deps: FilterStoreDeps = {}): FilterStore {
  const navLanguages =
    deps.navLanguages ?? (typeof navigator !== "undefined" ? navigator.languages : []);
  const defaults = defaultFilterState(navLanguages);
  const workerBacked = deps.storage === undefined && hasWorkerTransport();
  const raw = workerBacked
    ? undefined
    : syncedStore<FilterState>(KEY, defaults, deps.storage ?? syncArea());
  const normalize = (value: unknown): FilterState => normalizeFilterState(value, defaults);
  const state = signal<FilterState>(normalize(raw?.current() ?? defaults));
  const revealed = signal(false);
  let confirmed = state.value;
  let writes = Promise.resolve<unknown>(undefined);
  let disposed = false;

  const resumeFiltering = (): void => {
    if (revealed.value) revealed.value = false;
  };
  const adopt = (next: FilterState): void => {
    if (selectionChanged(state.value, next)) resumeFiltering();
    confirmed = next;
    state.value = next;
  };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writes.then(operation, operation);
    writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const stopExternalChanges = workerBacked
    ? watchStorageKey("sync", KEY, ({ newValue }) => adopt(normalize(newValue)))
    : raw!.onExternalChange((next) => adopt(normalize(next)));

  function persistRaw(snapshot: FilterState): void {
    void raw!.write(snapshot).then(
      () => {
        if (raw!.current() === snapshot && state.value !== snapshot)
          state.value = normalize(raw!.current());
        confirmed = normalize(raw!.current());
      },
      () => {
        if (state.value === snapshot) state.value = confirmed;
      },
    );
  }

  function persistWorker(command: FilterCommand, optimistic: FilterState): void {
    void enqueue(() => requestFilterCommand(command, defaults.myLanguages)).then(
      (authority) => {
        confirmed = authority;
        // A newer local command remains optimistically visible until its own reply.
        if (state.value === optimistic) state.value = authority;
      },
      () => {
        // Public mutators are fail-soft. Only roll back their own still-visible snapshot.
        if (state.value === optimistic) state.value = confirmed;
      },
    );
  }

  function dispatch(command: FilterCommand): void {
    const before = state.value;
    const optimistic = applyFilterCommand(before, command);
    if (resumesFiltering(command, before, optimistic)) resumeFiltering();
    state.value = optimistic;
    if (workerBacked) persistWorker(command, optimistic);
    else persistRaw(optimistic);
  }

  return {
    state,
    revealed,
    cycle: (id) => dispatch({ type: "cycle", id }),
    setMode: (id, mode) => dispatch({ type: "set-mode", id, mode }),
    setOnlyMyLanguages: (on) => dispatch({ type: "set-only-my-languages", on }),
    setMyLanguages: (languages) =>
      dispatch({ type: "set-my-languages", languages: normalizeLangs(languages) }),
    setLinkRules: (rules) =>
      dispatch({ type: "set-link-rules", rules: rules.map((rule) => ({ ...rule })) }),
    setEnabled: (on) => dispatch({ type: "set-enabled", on }),
    setCompactHidden: (on) => dispatch({ type: "set-compact-hidden", on }),
    setRevealed: (on) => {
      revealed.value = on && state.value.enabled;
    },
    savePreset(name) {
      const id = globalThis.crypto.randomUUID();
      dispatch({ type: "save-preset", id, name });
      return id;
    },
    applyPreset: (id) => dispatch({ type: "apply-preset", id }),
    renamePreset: (id, name) => dispatch({ type: "rename-preset", id, name }),
    deletePreset: (id) => dispatch({ type: "delete-preset", id }),
    async load() {
      if (workerBacked) {
        const startedAt = state.value;
        try {
          const authority = await requestFilterRead(defaults.myLanguages);
          confirmed = authority;
          if (state.value === startedAt) state.value = authority;
        } catch {
          // Defaults remain visible if the service worker is unavailable.
        }
        return;
      }
      await raw!.hydrate().catch(() => {});
      const next = normalize(raw!.current());
      confirmed = next;
      state.value = next;
    },
    restore: (next) => dispatch({ type: "restore", state: normalize(next) }),
    dispose() {
      if (disposed) return;
      disposed = true;
      stopExternalChanges();
    },
  };
}
