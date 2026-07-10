import { syncedStore } from "@/core/synced-store";

/** Minimal storage surface we depend on — matches chrome.storage areas and our test mock. */
export interface StorageLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

export type BackendStrategy = "rest" | "dom" | "graphql";

/** How the UI activates (ADR-0006). "auto" = always-on; "on-demand" = until toolbar click/hotkey. */
export type Activation = "auto" | "on-demand";

export interface LassoSettings {
  /** Active backend; REST v1.1 is the default (ADR-0007). */
  backend: BackendStrategy;
  /** When set, Alt+Shift+L adds straight to this List — no picker (story beat 6). */
  defaultListId?: string;
  /** Key that toggles multi-select mode. */
  hotkeySelectMode: string;
  /** UI activation mode; "auto" (always-on) by default, switchable to "on-demand". */
  activation: Activation;
  /** Accessibility: AA-safe darker-blue button fills (story beat 9). */
  highContrast: boolean;
  /** Convex Mirror deployment URL; unset ⇒ Mirror disabled (ADR-0009). */
  convexUrl?: string;
  /** Convex Mirror device key; the one long-lived credential, unset ⇒ Mirror disabled. */
  convexDeviceKey?: string;
  /** Independent per-surface toggles for the filter UI (pill / command palette). */
  surfaces: { pill: boolean; palette: boolean };
  /** Persisted floating-pill position (px offset from X's bottom-right docks). */
  pillPosition: { x: number; y: number };
  /** Shortcut that opens the command palette. */
  paletteHotkey: string;
}

export const DEFAULT_SETTINGS: LassoSettings = {
  backend: "rest", // X's stable v1.1 REST API (live-verified) — locale/DOM-independent
  hotkeySelectMode: "s",
  activation: "auto",
  highContrast: false,
  // Mirror config falls back to the build-time Convex env (.env.local) ONLY in dev
  // builds, so a contributor's fresh profile reaches the deployment with no manual
  // setup. Production builds never inline the credential (M1: a shipped device key
  // is one extracted key = full read/write) — prod users enter the URL + device key
  // in Options, and an absent key keeps the Mirror off (ADR-0009).
  convexUrl: import.meta.env.DEV ? import.meta.env.VITE_CONVEX_URL || undefined : undefined,
  convexDeviceKey: import.meta.env.DEV
    ? import.meta.env.VITE_LASSO_DEVICE_KEY || undefined
    : undefined,
  surfaces: { pill: true, palette: false },
  pillPosition: { x: 24, y: 96 },
  paletteHotkey: "mod+shift+f",
};

// NOTE: must equal STORAGE_KEYS.settings (storage-keys.ts imports our types,
// so the literal lives here to avoid an import cycle; pinned by tests).
const KEY = "lasso:settings";

export interface SettingsStore {
  get(): Promise<LassoSettings>;
  set(patch: Partial<LassoSettings>): Promise<LassoSettings>;
  subscribe(cb: (s: LassoSettings) => void): () => void;
}

/**
 * Typed wrapper over chrome.storage.sync with in- and cross-context change
 * notification. A thin face over {@link syncedStore} (which owns the cache, merge,
 * echo-suppression, and the raw listener): get() is a cached read; set() is STRICT
 * — it re-throws on storage failure so the Options page can surface the error, and
 * because lasso:settings holds the Mirror credential (ADR-0009), not the fail-soft
 * filter config.
 */
export function createSettings(
  area: StorageLike = chrome.storage.sync as unknown as StorageLike,
): SettingsStore {
  const store = syncedStore<LassoSettings>(KEY, DEFAULT_SETTINGS, area);
  const subs = new Set<(s: LassoSettings) => void>();
  function notify(next: LassoSettings): void {
    for (const cb of subs) cb(next);
  }

  async function get(): Promise<LassoSettings> {
    await store.hydrate();
    return store.current();
  }

  async function set(patch: Partial<LassoSettings>): Promise<LassoSettings> {
    // Merge over the cache (kept fresh by onExternalChange), not a fresh storage
    // read — deliberate, paired with the cached get(). Successive same-context
    // set()s see each other (write() updates the cache synchronously). The only
    // gap is a cross-context write to *another* field landing inside this context's
    // onChanged-propagation window: a last-write-wins race chrome.storage can't
    // avoid regardless (no atomic read-modify-write), and settings are user-paced.
    await store.hydrate();
    const next = { ...store.current(), ...patch };
    await store.write(next);
    notify(next);
    return next;
  }

  function subscribe(cb: (s: LassoSettings) => void): () => void {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }

  // A write from another context (Options toggles a surface, popup flips a flag)
  // must reach this context's subscribers — e.g. the in-page surface manager.
  store.onExternalChange(notify);

  return { get, set, subscribe };
}
