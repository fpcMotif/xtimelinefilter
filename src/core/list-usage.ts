import type { StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";
import type { XList } from "@/core/x-client/types";

const KEY = STORAGE_KEYS.listUsage;

/** Stored per List: pick count + last-picked timestamp. Legacy entries were bare counts. */
interface UsageEntry {
  n: number;
  t: number;
}

export interface ListUsage {
  /** Bump the pick count for a list (call when the user assigns to it). */
  record(listId: string): Promise<void>;
  /** Most-picked lists first; never-picked lists keep the API order. */
  rank(lists: XList[]): Promise<XList[]>;
  /** Most recently used list ids, newest first — the picker's Recent group. */
  recentIds(limit: number): Promise<string[]>;
}

/** Tracks how often/recently each List is picked so the picker surfaces frequent ones first. */
export function createListUsage(
  area: StorageLike = chrome.storage.local as unknown as StorageLike,
  now: () => number = Date.now,
): ListUsage {
  async function entries(): Promise<Record<string, UsageEntry>> {
    const raw =
      ((await area.get(KEY))[KEY] as Record<string, number | UsageEntry> | undefined) ?? {};
    return Object.fromEntries(
      Object.entries(raw).map(([id, v]) => [id, typeof v === "number" ? { n: v, t: 0 } : v]),
    );
  }

  return {
    async record(listId) {
      const all = await entries();
      const prev = all[listId];
      await area.set({ [KEY]: { ...all, [listId]: { n: (prev?.n ?? 0) + 1, t: now() } } });
    },
    async rank(lists) {
      const all = await entries();
      return lists
        .map((list, i) => ({ list, i, uses: all[list.id]?.n ?? 0 }))
        .toSorted((a, b) => b.uses - a.uses || a.i - b.i)
        .map((x) => x.list);
    },
    async recentIds(limit) {
      const all = await entries();
      return Object.entries(all)
        .filter(([, e]) => e.n > 0)
        .toSorted((a, b) => b[1].t - a[1].t)
        .slice(0, limit)
        .map(([id]) => id);
    },
  };
}
