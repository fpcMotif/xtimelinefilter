import { localArea, type StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";

export const LIST_USAGE_PREFIX = `${STORAGE_KEYS.listUsage}:`;

interface UsageEntry {
  lastPickedAt: number;
}

const ownerKey = (ownerUserId: string): string =>
  `${LIST_USAGE_PREFIX}${encodeURIComponent(ownerUserId)}`;

const listKey = (ownerUserId: string, listId: string): string =>
  `${ownerKey(ownerUserId)}:${encodeURIComponent(listId)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const decodeListId = (value: string): string | null => {
  try {
    const listId = decodeURIComponent(value);
    return encodeURIComponent(listId) === value ? listId : null;
  } catch {
    return null;
  }
};

export interface ListUsage {
  record(ownerUserId: string, listId: string): Promise<void>;
  recentIds(ownerUserId: string, limit: number): Promise<string[]>;
}

/** One key per Owner/List keeps concurrent extension contexts independent. */
export function createListUsage(
  area: StorageLike = localArea(),
  now: () => number = Date.now,
): ListUsage {
  return {
    async record(ownerUserId, listId) {
      try {
        const timestamp = now();
        if (!isTimestamp(timestamp)) return;
        await area.set({ [listKey(ownerUserId, listId)]: timestamp });
      } catch {
        // Usage is a picker hint, never a user-visible failure.
      }
    },
    async recentIds(ownerUserId, limit) {
      try {
        const prefix = `${ownerKey(ownerUserId)}:`;
        const values = await area.get(null);
        if (!isRecord(values)) return [];
        return Object.entries(values)
          .filter(([key, timestamp]) => key.startsWith(prefix) && isTimestamp(timestamp))
          .map(([key, lastPickedAt]) => ({
            listId: decodeListId(key.slice(prefix.length)),
            lastPickedAt,
          }))
          .filter(
            (entry): entry is { listId: string; lastPickedAt: UsageEntry["lastPickedAt"] } =>
              entry.listId !== null,
          )
          .toSorted((a, b) => b.lastPickedAt - a.lastPickedAt)
          .slice(0, limit)
          .map(({ listId }) => listId);
      } catch {
        return [];
      }
    },
  };
}
