import type { StorageLike } from "@/core/settings";

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

const LOCAL_KEYS = [
  STORAGE_KEYS.lists,
  STORAGE_KEYS.listUsage,
  STORAGE_KEYS.coach,
  STORAGE_KEYS.mirrorStatus,
];
const SYNC_KEYS = [STORAGE_KEYS.settings, STORAGE_KEYS.filter];

/** Wipes everything Lasso keeps ("Clear Lasso data"), local and sync alike. */
export async function clearLassoData(local: StorageLike, sync: StorageLike): Promise<void> {
  if (local.remove) await local.remove(LOCAL_KEYS);
  else await local.set(Object.fromEntries(LOCAL_KEYS.map((k) => [k, undefined])));
  if (sync.remove) await sync.remove(SYNC_KEYS);
  else await sync.set(Object.fromEntries(SYNC_KEYS.map((k) => [k, undefined])));
}
