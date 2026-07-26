import { normalizeCacheObservation, type CacheObservation } from "@/core/cache-observation";
import { requestListCache } from "@/core/protocol";
import { STORAGE_KEYS } from "@/core/storage-keys";
import type { Owner, OwnerCatalog } from "@/packages/membership-store/types";
import type { XList } from "@/packages/x-client/types";

export const LIST_CACHE_PREFIX = `${STORAGE_KEYS.lists}:`;

export class ListCacheOwnerChangedError extends Error {
  constructor() {
    super("X account changed while loading Lists");
    this.name = "ListCacheOwnerChangedError";
  }
}

export interface CachedOwnerCatalog {
  schema: 2;
  owner: Owner;
  lists: XList[];
  refreshedAt: number;
  observation: CacheObservation;
}

export const listCacheOwnerKey = (ownerUserId: string): string =>
  `${LIST_CACHE_PREFIX}${encodeURIComponent(ownerUserId)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const positiveId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,63}$/.test(value);
const isOwner = (value: unknown): value is Owner =>
  isRecord(value) &&
  positiveId(value.userId) &&
  typeof value.screenName === "string" &&
  [...value.screenName].length <= 50;

const sameOwner = (expected: Owner | null, actual: Owner | null): boolean =>
  expected === null ? actual === null : actual?.userId === expected.userId;

export const isCachedList = (value: unknown): value is XList =>
  isRecord(value) &&
  positiveId(value.id) &&
  typeof value.name === "string" &&
  value.name.trim().length > 0 &&
  [...value.name].length <= 100 &&
  (value.memberCount === undefined ||
    (typeof value.memberCount === "number" &&
      Number.isSafeInteger(value.memberCount) &&
      value.memberCount >= 0)) &&
  (value.isPrivate === undefined || typeof value.isPrivate === "boolean");

export function parseCachedOwnerCatalog(value: unknown): CachedOwnerCatalog | null {
  if (!isRecord(value)) return null;
  const row = value as Partial<CachedOwnerCatalog>;
  if (
    row.schema !== 2 ||
    !isOwner(row.owner) ||
    !Array.isArray(row.lists) ||
    row.lists.length > 1000 ||
    !row.lists.every(isCachedList) ||
    typeof row.refreshedAt !== "number" ||
    !Number.isFinite(row.refreshedAt) ||
    row.refreshedAt < 0 ||
    !Number.isSafeInteger(row.refreshedAt) ||
    !normalizeCacheObservation(row.observation)
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
  catalog?: ListCatalogPort;
  /** Re-read after X answers. A changed session must never be cached under the old Owner. */
  currentOwner?: () => Owner | null;
}

/** Worker-owned catalog operations. Fakes model cache behavior, never storage. */
export interface ListCatalogPort {
  read(owner: Owner): Promise<XList[] | null>;
  all(): Promise<OwnerCatalog[]>;
  begin(owner: Owner): Promise<CacheObservation>;
  commit(owner: Owner, token: CacheObservation, lists: XList[]): Promise<XList[] | null>;
}

export function createWorkerListCatalogPort(): ListCatalogPort {
  return {
    async read(owner) {
      const response = await requestListCache({
        type: "lasso:list-cache",
        operation: "read",
        owner,
      });
      return "lists" in response ? response.lists : null;
    },
    async all() {
      const response = await requestListCache({ type: "lasso:list-cache", operation: "all" });
      return "catalogs" in response ? response.catalogs : [];
    },
    async begin(owner) {
      const response = await requestListCache({
        type: "lasso:list-cache",
        operation: "begin",
        owner,
      });
      if (!("token" in response)) throw new Error("List cache token unavailable");
      return response.token;
    },
    async commit(owner, token, lists) {
      const response = await requestListCache({
        type: "lasso:list-cache",
        operation: "commit",
        owner,
        token,
        lists,
      });
      return "lists" in response ? response.lists : null;
    },
  };
}

/** Reads every safely Owner-qualified catalog from the worker. */
export async function readCachedCatalog(
  catalog: Pick<ListCatalogPort, "all"> = createWorkerListCatalogPort(),
): Promise<OwnerCatalog[]> {
  try {
    return await catalog.all();
  } catch {
    return [];
  }
}

/** One key per Owner isolates cached X catalogs. */
export function createListCache(
  loader: (owner: Owner | null) => Promise<XList[]>,
  options: ListCacheOptions = {},
): ListCache {
  const catalog = options.catalog ?? createWorkerListCatalogPort();
  const currentOwner = options.currentOwner;

  return {
    async cached(owner) {
      if (!owner) return null;
      try {
        return await catalog.read(owner);
      } catch {
        return null;
      }
    },
    async refresh(owner) {
      let token: CacheObservation | null = null;
      if (owner) {
        try {
          token = await catalog.begin(owner);
        } catch {
          // The fetch remains useful when the optional cache worker is unavailable.
        }
      }
      const fresh = await loader(owner);
      if (currentOwner && !sameOwner(owner, currentOwner())) {
        throw new ListCacheOwnerChangedError();
      }
      if (!owner || !token) return fresh;
      try {
        if (currentOwner && !sameOwner(owner, currentOwner()))
          throw new ListCacheOwnerChangedError();
        return (await catalog.commit(owner, token, fresh)) ?? fresh;
      } catch (error: unknown) {
        if (error instanceof ListCacheOwnerChangedError) throw error;
        return fresh;
      }
    },
  };
}
