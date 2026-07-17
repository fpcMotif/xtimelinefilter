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
}

export const DEFAULT_SETTINGS: LassoSettings = {
  backend: "rest", // X's stable v1.1 REST API (live-verified) — locale/DOM-independent
  hotkeySelectMode: "s",
  activation: "auto",
  highContrast: false,
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
 * Typed wrapper over chrome.storage.local with in-context change notification.
 * Settings used to live in storage.sync; Chrome Sync replicates that area to
 * the user's Google account, which contradicts the product's local-only privacy
 * claims (PRIVACY_LINE / ADR-0005 invariant 3) — so the store is local now and
 * any pre-migration synced copy is moved across once on first read.
 */
export function createSettings(
  area: StorageLike = chrome.storage.local as unknown as StorageLike,
  legacySyncArea: StorageLike | null = chrome.storage.sync as unknown as StorageLike,
): SettingsStore {
  const subs = new Set<(s: LassoSettings) => void>();
  let migrated = false;

  async function migrateOnce(): Promise<void> {
    if (migrated) return;
    migrated = true;
    if (!legacySyncArea) return;
    try {
      const localRaw = (await area.get(KEY))[KEY];
      if (localRaw !== undefined) return; // local already authoritative
      const synced = (await legacySyncArea.get(KEY))[KEY];
      if (synced === undefined) return;
      await area.set({ [KEY]: synced });
      await legacySyncArea.remove?.(KEY);
    } catch {
      // migration is best-effort; a failure must never break settings reads
    }
  }

  async function get(): Promise<LassoSettings> {
    await migrateOnce();
    const raw = (await area.get(KEY))[KEY] as Partial<LassoSettings> | undefined;
    return { ...DEFAULT_SETTINGS, ...raw };
  }

  async function set(patch: Partial<LassoSettings>): Promise<LassoSettings> {
    await migrateOnce();
    const next = { ...(await get()), ...patch };
    await area.set({ [KEY]: next });
    for (const cb of subs) cb(next);
    return next;
  }

  function subscribe(cb: (s: LassoSettings) => void): () => void {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }

  return { get, set, subscribe };
}
