import { rotateCacheObservationClock } from "@/core/cache-observation";
import type { StorageLike } from "@/core/storage-areas";
import {
  clearLassoData,
  clearLassoSyncData,
  type ClearLassoDataResult,
} from "@/core/storage-clear";
import { STORAGE_KEYS } from "@/core/storage-keys";

/** Fence async cache work before wiping data. The terminal migration state survives. */
export async function erasePrivateData(
  local: StorageLike,
  sync: StorageLike,
  createCacheUuid: () => string,
): Promise<ClearLassoDataResult> {
  try {
    const raw = (await local.get(STORAGE_KEYS.cacheObservation))[STORAGE_KEYS.cacheObservation];
    await local.set({
      [STORAGE_KEYS.settingsMigration]: "cleared",
      [STORAGE_KEYS.cacheObservation]: rotateCacheObservationClock(raw, createCacheUuid),
    });
  } catch {
    // A partial local clear without a durable epoch fence would let work begun
    // before Clear recreate deleted caches. Keep local state intact and report
    // failure; synced data has no async cache writers and can still be erased.
    return { localCleared: false, syncCleared: await clearLassoSyncData(sync) };
  }
  return clearLassoData(local, sync);
}
