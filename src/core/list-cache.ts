import type { Owner, OwnerCatalog } from "@/core/membership-store/types";
import { localArea, type StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";
import type { XList } from "@/core/x-client/types";

export const LIST_CACHE_PREFIX = `${STORAGE_KEYS.lists}:`;

export class ListCacheOwnerChangedError extends Error {
  constructor() {
    super("X account changed while loading Lists");
    this.name = "ListCacheOwnerChangedError";
  }
}

interface CachedOwnerCatalog {
  schema: 1;
  owner: Owner;
  lists: XList[];
  refreshedAt: number;
}

const ownerKey = (ownerUserId: string): string =>
  `${LIST_CACHE_PREFIX}${encodeURIComponent(ownerUserId)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isOwner = (value: unknown): value is Owner =>
  isRecord(value) && typeof value.userId === "string" && typeof value.screenName === "string";

const sameOwner = (expected: Owner | null, actual: Owner | null): boolean =>
  expected === null ? actual === null : actual?.userId === expected.userId;

const isList = (value: unknown): value is XList =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  (value.memberCount === undefined ||
    (typeof value.memberCount === "number" &&
      Number.isFinite(value.memberCount) &&
      value.memberCount >= 0)) &&
  (value.isPrivate === undefined || typeof value.isPrivate === "boolean");

function parse(value: unknown): CachedOwnerCatalog | null {
  if (!isRecord(value)) return null;
  const row = value as Partial<CachedOwnerCatalog>;
  if (
    row.schema !== 1 ||
    !isOwner(row.owner) ||
    !Array.isArray(row.lists) ||
    !row.lists.every(isList) ||
    typeof row.refreshedAt !== "number" ||
    !Number.isFinite(row.refreshedAt) ||
    row.refreshedAt < 0
  ) {
    return null;
  }
  return row as CachedOwnerCatalog;
}

export interface ListCache {
  /** Null means this Owner has never been loaded. Empty means X confirmed no Lists. */
  cached(owner: Owner | null): Promise<XList[] | null>;
  /** Replaces this Owner's cache with X's full answer, including an empty answer. */
  refresh(owner: Owner | null): Promise<XList[]>;
}

export interface ListCacheOptions {
  area?: StorageLike;
  now?: () => number;
  /** Re-read after X answers. A changed session must never be cached under the old Owner. */
  currentOwner?: () => Owner | null;
}

/** Reads every safely Owner-qualified local catalog. Legacy global rows are ignored. */
export async function readCachedCatalog(area: StorageLike = localArea()): Promise<OwnerCatalog[]> {
  try {
    const items = await area.get(null);
    if (!isRecord(items)) return [];
    return Object.entries(items)
      .filter(([key]) => key.startsWith(LIST_CACHE_PREFIX))
      .map(([key, value]) => ({ key, catalog: parse(value) }))
      .filter(
        (value): value is { key: string; catalog: CachedOwnerCatalog } =>
          value.catalog !== null && value.key === ownerKey(value.catalog.owner.userId),
      )
      .sort((a, b) => a.catalog.owner.screenName.localeCompare(b.catalog.owner.screenName))
      .map(({ catalog: { owner, lists } }) => ({ owner, lists }));
  } catch {
    return [];
  }
}

/** One key per Owner isolates cached X catalogs. */
export function createListCache(
  loader: (owner: Owner | null) => Promise<XList[]>,
  options: ListCacheOptions = {},
): ListCache {
  const area = options.area ?? localArea();
  const now = options.now ?? Date.now;
  const currentOwner = options.currentOwner;
  const refreshEpochs = new Map<string, number>();
  // A blocked older set must settle before the latest same-Owner set starts.
  const persistenceTails = new Map<string, Promise<void>>();

  function enqueuePersistence(key: string, persist: () => Promise<void>): Promise<void> {
    const previous = persistenceTails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(persist);
    persistenceTails.set(key, current);
    const retire = (): void => {
      if (persistenceTails.get(key) === current) persistenceTails.delete(key);
    };
    void current.then(retire, retire);
    return current;
  }

  return {
    async cached(owner) {
      if (!owner) return null;
      try {
        const key = ownerKey(owner.userId);
        const values = await area.get(key);
        if (!isRecord(values)) return null;
        const catalog = parse(values[key]);
        return catalog?.owner.userId === owner.userId ? catalog.lists : null;
      } catch {
        return null;
      }
    },
    async refresh(owner) {
      const key = owner ? ownerKey(owner.userId) : null;
      const refreshEpoch = key === null ? 0 : (refreshEpochs.get(key) ?? 0) + 1;
      if (key !== null) refreshEpochs.set(key, refreshEpoch);
      const fresh = await loader(owner);
      if (currentOwner && !sameOwner(owner, currentOwner())) {
        throw new ListCacheOwnerChangedError();
      }
      if (!owner || key === null) return fresh;
      await enqueuePersistence(key, async () => {
        if (currentOwner && !sameOwner(owner, currentOwner())) {
          throw new ListCacheOwnerChangedError();
        }
        if (refreshEpochs.get(key) !== refreshEpoch) return;
        try {
          await area.set({
            [key]: { schema: 1, owner, lists: fresh, refreshedAt: now() },
          });
        } catch {
          // X is authoritative; local persistence is optional.
        }
      });
      return fresh;
    },
  };
}
