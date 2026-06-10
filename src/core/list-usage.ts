import type { StorageLike } from "@/core/settings";
import type { XList } from "@/core/x-client/types";

const KEY = "lasso:list-usage";

export interface ListUsage {
  /** Bump the pick count for a list (call when the user assigns to it). */
  record(listId: string): Promise<void>;
  /** Most-picked lists first; never-picked lists keep the API order. */
  rank(lists: XList[]): Promise<XList[]>;
}

/** Tracks how often each List is picked so the picker surfaces frequent ones first. */
export function createListUsage(
  area: StorageLike = chrome.storage.local as unknown as StorageLike,
): ListUsage {
  async function counts(): Promise<Record<string, number>> {
    return ((await area.get(KEY))[KEY] as Record<string, number> | undefined) ?? {};
  }

  return {
    async record(listId) {
      const c = await counts();
      await area.set({ [KEY]: { ...c, [listId]: (c[listId] ?? 0) + 1 } });
    },
    async rank(lists) {
      const c = await counts();
      return lists
        .map((list, i) => ({ list, i, uses: c[list.id] ?? 0 }))
        .toSorted((a, b) => b.uses - a.uses || a.i - b.i)
        .map((x) => x.list);
    },
  };
}
