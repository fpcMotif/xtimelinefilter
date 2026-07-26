import {
  beginCacheObservation,
  decideCacheObservation,
  normalizeCacheObservation,
  normalizeCacheObservationClock,
} from "@/core/cache-observation";
import { listCacheOwnerKey, parseCachedOwnerCatalog } from "@/core/list-cache";
import type {
  GraphqlCatalogRequest,
  GraphqlCatalogSuccess,
  ListCacheRequest,
  ListCacheSuccess,
} from "@/core/protocol";
import type { StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";
import {
  isGraphqlCatalog,
  type GraphqlOperationCatalog,
} from "@/packages/x-client/graphql-contract";

/** List and GraphQL caches share one persisted observation clock and its fences. */
export function createObservedXCache(local: StorageLike, createCacheUuid: () => string) {
  const issueObservation = async () => {
    const raw = (await local.get(STORAGE_KEYS.cacheObservation))[STORAGE_KEYS.cacheObservation];
    const next = beginCacheObservation(raw, createCacheUuid);
    await local.set({ [STORAGE_KEYS.cacheObservation]: next.clock });
    return next.observation;
  };

  const listCache = async (request: ListCacheRequest): Promise<ListCacheSuccess> => {
    if (request.operation === "all") {
      const items = await local.get(null);
      const catalogs = Object.entries(items)
        .filter(([key]) => key.startsWith(`${STORAGE_KEYS.lists}:`))
        .map(([key, value]) => ({ key, catalog: parseCachedOwnerCatalog(value) }))
        .filter(
          (row) =>
            row.catalog &&
            row.key === listCacheOwnerKey(row.catalog.owner.userId) &&
            decideCacheObservation(
              normalizeCacheObservationClock(items[STORAGE_KEYS.cacheObservation], createCacheUuid),
              row.catalog.observation,
            ) === "existing",
        )
        .map((row) => ({ owner: row.catalog!.owner, lists: row.catalog!.lists }))
        // oxlint-disable-next-line unicorn/no-array-sort -- fresh owned array; Chrome 106 lacks toSorted().
        .sort((left, right) => left.owner.screenName.localeCompare(right.owner.screenName))
        .slice(0, 32);
      return { catalogs };
    }
    const key = listCacheOwnerKey(request.owner.userId);
    if (request.operation === "read") {
      const catalog = parseCachedOwnerCatalog((await local.get(key))[key]);
      const clock = normalizeCacheObservationClock(
        (await local.get(STORAGE_KEYS.cacheObservation))[STORAGE_KEYS.cacheObservation],
        createCacheUuid,
      );
      return {
        lists:
          catalog?.owner.userId === request.owner.userId &&
          decideCacheObservation(clock, catalog.observation) === "existing"
            ? catalog.lists
            : null,
      };
    }
    if (request.operation === "begin") return { token: await issueObservation() };
    const values = await local.get([key, STORAGE_KEYS.cacheObservation]);
    const clock = normalizeCacheObservationClock(
      values[STORAGE_KEYS.cacheObservation],
      createCacheUuid,
    );
    const existing = parseCachedOwnerCatalog(values[key]);
    const token = normalizeCacheObservation(request.token);
    const decision = decideCacheObservation(clock, existing?.observation, token);
    if (decision === "existing" && existing) return { lists: existing.lists };
    if (decision === "empty") return { lists: null };
    const now = Date.now();
    const refreshedAt = Number.isSafeInteger(now) && now >= 0 ? now : 0;
    await local.set({
      [key]: {
        schema: 2,
        owner: request.owner,
        lists: request.lists,
        refreshedAt,
        observation: token,
      },
    });
    return { lists: request.lists };
  };

  const graphqlCatalog = async (request: GraphqlCatalogRequest): Promise<GraphqlCatalogSuccess> => {
    const raw = await local.get([STORAGE_KEYS.graphqlCatalog, STORAGE_KEYS.cacheObservation]);
    const envelope = raw[STORAGE_KEYS.graphqlCatalog];
    const rawEntry = envelope as Record<string, unknown>;
    const storedFetchedAt = rawEntry?.fetchedAt;
    const entry =
      typeof envelope === "object" &&
      envelope !== null &&
      isGraphqlCatalog(rawEntry.catalog) &&
      typeof storedFetchedAt === "number" &&
      Number.isSafeInteger(storedFetchedAt) &&
      storedFetchedAt >= 0 &&
      normalizeCacheObservation(rawEntry.observation)
        ? (envelope as {
            catalog: GraphqlOperationCatalog;
            fetchedAt: number;
            observation: import("@/core/cache-observation").CacheObservation;
          })
        : null;
    const clock = normalizeCacheObservationClock(
      raw[STORAGE_KEYS.cacheObservation],
      createCacheUuid,
    );
    if (request.operation === "read") {
      return {
        entry:
          decideCacheObservation(clock, entry?.observation) === "existing" && entry
            ? { catalog: entry.catalog, fetchedAt: entry.fetchedAt }
            : null,
      };
    }
    if (request.operation === "begin") return { token: await issueObservation() };
    const token = normalizeCacheObservation(request.token);
    const decision = decideCacheObservation(clock, entry?.observation, token);
    if (decision === "existing" && entry)
      return { entry: { catalog: entry.catalog, fetchedAt: entry.fetchedAt } };
    if (decision === "empty") return { entry: null };
    const now = Date.now();
    const fetchedAt = Number.isSafeInteger(now) && now >= 0 ? now : 0;
    await local.set({
      [STORAGE_KEYS.graphqlCatalog]: { catalog: request.catalog, fetchedAt, observation: token },
    });
    return { entry: { catalog: request.catalog, fetchedAt } };
  };

  return { listCache, graphqlCatalog };
}
