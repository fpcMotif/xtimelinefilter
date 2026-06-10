import { fuzzyRank } from "@/core/fuzzy";
import type { StorageLike } from "@/core/settings";
import type { XList } from "@/core/x-client/types";

const KEY = "lasso:lists";

export interface ListCache {
  /** Cached lists; pass {force:true} to refetch (e.g. when opening the picker). */
  lists(opts?: { force?: boolean }): Promise<XList[]>;
  /** Fuzzy-ranked lists matching the query; empty query returns all. */
  search(query: string): Promise<XList[]>;
}

/** Caches the user's Lists from `loader` (decoupled from the add-backend). */
export function createListCache(
  loader: () => Promise<XList[]>,
  area: StorageLike = chrome.storage.local as unknown as StorageLike,
): ListCache {
  async function lists({ force = false }: { force?: boolean } = {}): Promise<XList[]> {
    if (!force) {
      const cached = (await area.get(KEY))[KEY] as XList[] | undefined;
      if (cached?.length) return cached;
    }
    const fresh = await loader();
    await area.set({ [KEY]: fresh });
    return fresh;
  }

  async function search(query: string): Promise<XList[]> {
    return fuzzyRank(query, await lists(), (l) => l.name);
  }

  return { lists, search };
}
