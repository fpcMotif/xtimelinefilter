/** Minimal storage surface we depend on — matches chrome.storage areas and our test mock. */
export interface StorageLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type BackendStrategy = "rest" | "dom" | "graphql";

/** How the UI activates (ADR-0006). "auto" = always-on; "on-demand" = until toolbar click/hotkey. */
export type Activation = "auto" | "on-demand";

export interface LassoSettings {
  /** Active backend; DOM is the policy-conservative default (ADR-0001). */
  backend: BackendStrategy;
  defaultListId?: string;
  /** Key that toggles multi-select mode. */
  hotkeySelectMode: string;
  /** UI activation mode; "auto" (always-on) by default, switchable to "on-demand". */
  activation: Activation;
}

export const DEFAULT_SETTINGS: LassoSettings = {
  backend: "rest", // X's stable v1.1 REST API (live-verified) — locale/DOM-independent
  hotkeySelectMode: "s",
  activation: "auto",
};

const KEY = "lasso:settings";

export interface SettingsStore {
  get(): Promise<LassoSettings>;
  set(patch: Partial<LassoSettings>): Promise<LassoSettings>;
  subscribe(cb: (s: LassoSettings) => void): () => void;
}

/** Typed wrapper over chrome.storage.sync with in-context change notification. */
export function createSettings(
  area: StorageLike = chrome.storage.sync as unknown as StorageLike,
): SettingsStore {
  const subs = new Set<(s: LassoSettings) => void>();

  async function get(): Promise<LassoSettings> {
    const raw = (await area.get(KEY))[KEY] as Partial<LassoSettings> | undefined;
    return { ...DEFAULT_SETTINGS, ...raw };
  }

  async function set(patch: Partial<LassoSettings>): Promise<LassoSettings> {
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
