import { fuzzyRank } from "@/core/fuzzy";
import { blobStore, localArea, type StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";
import type { XList } from "@/core/x-client/types";

const KEY = STORAGE_KEYS.lists;

export interface ListCache {
  /** Cached lists; pass {force:true} to refetch (e.g. when opening the picker). */
  lists(opts?: { force?: boolean }): Promise<XList[]>;
  /** Fuzzy-ranked lists matching the query; empty query returns all. */
  search(query: string): Promise<XList[]>;
}

/** Caches the user's Lists from `loader` (decoupled from the add-backend). */
export function createListCache(
  loader: () => Promise<XList[]>,
  area: StorageLike = localArea(),
): ListCache {
  const store = blobStore<XList[]>(area, KEY, []);

  async function lists({ force = false }: { force?: boolean } = {}): Promise<XList[]> {
    if (!force) {
      const cached = await store.get();
      if (cached.length) return cached;
    }
    const fresh = await loader();
    await store.set(fresh);
    return fresh;
  }

  async function search(query: string): Promise<XList[]> {
    return fuzzyRank(query, await lists(), (l) => l.name);
  }

  return { lists, search };
}
