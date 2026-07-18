import type { StorageLike } from "@/core/storage-areas";

/**
 * Every key Lasso writes, named in one place so the Settings "Privacy & data"
 * surface can truthfully list — and wipe — all of them (story beat 9).
 */
export const STORAGE_KEYS = {
  /** chrome.storage.local — cached Lists */
  lists: "lasso:lists",
  /** chrome.storage.local — per-List pick counts/recency */
  listUsage: "lasso:list-usage",
  /** chrome.storage.sync — user settings */
  settings: "lasso:settings",
  /** chrome.storage.sync — the one global timeline filter (createFilterStore) */
  filter: "lasso:filter",
  /** chrome.storage.local — onboarding + decaying-hint state */
  coach: "lasso:coach",
  /** chrome.storage.local — last Mirror write outcome ({ok, at}; popup's Mirror row) */
  mirrorStatus: "lasso:mirror-status",
} as const;

/**
 * Which storage area each key lives in. `Record<keyof typeof STORAGE_KEYS, …>`
 * makes the compiler reject a key added above but not placed here, so the
 * privacy wipe can never silently skip a new store.
 */
const KEY_AREAS: Record<keyof typeof STORAGE_KEYS, "local" | "sync"> = {
  lists: "local",
  listUsage: "local",
  settings: "sync",
  filter: "sync",
  coach: "local",
  mirrorStatus: "local",
};

const keysIn = (area: "local" | "sync"): string[] =>
  (Object.keys(STORAGE_KEYS) as (keyof typeof STORAGE_KEYS)[])
    .filter((k) => KEY_AREAS[k] === area)
    .map((k) => STORAGE_KEYS[k]);

const LOCAL_KEYS = keysIn("local");
const SYNC_KEYS = keysIn("sync");

/** Wipes everything Lasso keeps ("Clear Lasso data"), local and sync alike. */
export async function clearLassoData(local: StorageLike, sync: StorageLike): Promise<void> {
  if (local.remove) await local.remove(LOCAL_KEYS);
  else await local.set(Object.fromEntries(LOCAL_KEYS.map((k) => [k, undefined])));
  if (sync.remove) await sync.remove(SYNC_KEYS);
  else await sync.set(Object.fromEntries(SYNC_KEYS.map((k) => [k, undefined])));
}
