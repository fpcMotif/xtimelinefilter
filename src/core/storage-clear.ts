import type { StorageLike } from "@/core/storage-areas";
import { LOCAL_STORAGE_KEYS, STORAGE_KEYS, SYNC_STORAGE_KEYS } from "@/core/storage-keys";

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

async function clearLocalData(local: StorageLike): Promise<boolean> {
  const dynamicLocalKeys = Promise.resolve()
    .then(() => local.get(null))
    .then((items) =>
      Object.keys(items ?? {}).filter(
        (key) =>
          (key.startsWith(`${STORAGE_KEYS.lists}:`) ||
            key.startsWith(`${STORAGE_KEYS.listUsage}:`)) &&
          !LOCAL_STORAGE_KEYS.includes(key as never),
      ),
    )
    .catch(() => null);
  const fixedLocalCleared = await clear(local, LOCAL_STORAGE_KEYS);
  const discoveredKeys = await dynamicLocalKeys;
  const dynamicLocalCleared =
    discoveredKeys !== null && (!discoveredKeys.length || (await clear(local, discoveredKeys)));
  return fixedLocalCleared && dynamicLocalCleared;
}

/** Clears only synced Lasso data. Used when local privacy fencing cannot be established. */
export function clearLassoSyncData(sync: StorageLike): Promise<boolean> {
  return clear(sync, SYNC_STORAGE_KEYS);
}

/** Wipes Lasso's browser data, local and sync alike. It never deletes remote Mirror data. */
export async function clearLassoData(
  local: StorageLike,
  sync: StorageLike,
): Promise<ClearLassoDataResult> {
  const [localCleared, syncCleared] = await Promise.all([
    clearLocalData(local),
    clearLassoSyncData(sync),
  ]);
  return { localCleared, syncCleared };
}
