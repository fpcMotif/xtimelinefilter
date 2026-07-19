import type { StorageLike } from "@/core/storage-areas";

/**
 * Every key Lasso writes, named in one place so the Settings "Privacy & data"
 * surface can truthfully list — and wipe — the browser data it owns (story beat 9).
 */
export const STORAGE_KEYS = {
  /** chrome.storage.local — cached Lists */
  lists: "lasso:lists",
  /** chrome.storage.local — per-List pick counts/recency */
  listUsage: "lasso:list-usage",
  /** chrome.storage.local — user settings (legacy sync copy is migrated/removed; see settings.ts) */
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
  STORAGE_KEYS.settings,
  STORAGE_KEYS.coach,
  STORAGE_KEYS.mirrorStatus,
];
// settings stays here too so Clear also wipes any pre-local legacy copy.
const SYNC_KEYS = [STORAGE_KEYS.filter, STORAGE_KEYS.settings];

export interface ClearLassoDataResult {
  localCleared: boolean;
  syncCleared: boolean;
}

const clear = async (area: StorageLike, keys: string[]): Promise<boolean> => {
  try {
    if (area.remove) await area.remove(keys);
    else await area.set(Object.fromEntries(keys.map((key) => [key, undefined])));
    return true;
  } catch {
    return false;
  }
};

/** Wipes Lasso's browser data, local and sync alike. It never deletes remote Mirror data. */
export async function clearLassoData(
  local: StorageLike,
  sync: StorageLike,
): Promise<ClearLassoDataResult> {
  const dynamicLocalKeys = Promise.resolve()
    .then(() => local.get(null))
    .then((items) =>
      Object.keys(items ?? {}).filter(
        (key) =>
          key.startsWith(`${STORAGE_KEYS.lists}:`) || key.startsWith(`${STORAGE_KEYS.listUsage}:`),
      ),
    )
    .catch(() => null);
  const [fixedLocalCleared, syncCleared] = await Promise.all([
    clear(local, LOCAL_KEYS),
    clear(sync, SYNC_KEYS),
  ]);
  const discoveredKeys = await dynamicLocalKeys;
  const dynamicLocalCleared =
    discoveredKeys !== null && (!discoveredKeys.length || (await clear(local, discoveredKeys)));
  return { localCleared: fixedLocalCleared && dynamicLocalCleared, syncCleared };
}
