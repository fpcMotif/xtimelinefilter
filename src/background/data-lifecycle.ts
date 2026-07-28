import {
  createCollections,
  defaultCollectionStore,
  type CollectionStoreFactory,
} from "@/background/data-lifecycle/collections";
import {
  isCoachCommand,
  transitionCoach,
  type CoachCommand,
  type CoachCommandResult,
} from "@/core/coach-domain";
import {
  applyFilterCommand,
  defaultFilterState,
  normalizeFilterState,
  type FilterCommand,
} from "@/core/filter-domain";
import type { FilterState } from "@/core/filter-types";
import { LIST_USAGE_PREFIX } from "@/core/list-usage";
import { parseMirrorStatus } from "@/core/mirror-status";
import type {
  GraphqlCatalogRequest,
  GraphqlCatalogSuccess,
  ListCacheRequest,
  ListCacheSuccess,
  ListUsageRequest,
  ListUsageSuccess,
  MirrorStatusRequest,
  MirrorStatusSuccess,
} from "@/core/protocol";
import type { CollectionsRequest, CollectionsSuccess } from "@/core/protocol/collections";
import type { LassoSettings, SettingsPatch } from "@/core/settings-domain";
import type { StorageLike } from "@/core/storage-areas";
import type { ClearLassoDataResult } from "@/core/storage-clear";
import { STORAGE_KEYS } from "@/core/storage-keys";

import { createObservedXCache } from "./data-lifecycle/observed-x-cache";
import { erasePrivateData } from "./data-lifecycle/privacy-erase";
import { createSettingsAuthority } from "./data-lifecycle/settings-authority";
import { serializeWorkerStorage } from "./storage-queue";

let fallbackEpochSequence = 0;
const cacheUuid = (): string => {
  const generated = globalThis.crypto?.randomUUID?.();
  if (typeof generated === "string") return generated;
  fallbackEpochSequence = (fallbackEpochSequence + 1) % 0xffff_ffff;
  return `00000000-0000-4000-8000-${fallbackEpochSequence.toString(16).padStart(12, "0")}`;
};

export interface DataLifecycle {
  migrate(): Promise<boolean>;
  readSettings(): Promise<LassoSettings>;
  patchSettings(patch: SettingsPatch): Promise<LassoSettings>;
  readFilter(defaultLanguages: readonly string[]): Promise<FilterState>;
  commandFilter(command: FilterCommand, defaultLanguages: readonly string[]): Promise<FilterState>;
  runCoach(command: CoachCommand): Promise<CoachCommandResult>;
  listCache(request: ListCacheRequest): Promise<ListCacheSuccess>;
  listUsage(request: ListUsageRequest): Promise<ListUsageSuccess>;
  mirrorStatus(request: MirrorStatusRequest): Promise<MirrorStatusSuccess>;
  graphqlCatalog(request: GraphqlCatalogRequest): Promise<GraphqlCatalogSuccess>;
  collections(request: CollectionsRequest): Promise<CollectionsSuccess>;
  clear(): Promise<ClearLassoDataResult>;
}

/**
 * Public worker facade. It owns every storage queue; private seams own settings,
 * observed X caches, and privacy erase.
 */
export function createDataLifecycle(
  local: StorageLike,
  sync: StorageLike,
  createMirrorConfigId: () => string = () => globalThis.crypto.randomUUID(),
  /**
   * Opens the one collections database this worker owns. Injected so tests can
   * substitute an in-memory store — and so no other context ever names the
   * IndexedDB implementation.
   */
  openCollectionStore: CollectionStoreFactory = defaultCollectionStore,
): DataLifecycle {
  const serialize = <T>(operation: () => Promise<T>): Promise<T> =>
    serializeWorkerStorage(local, operation);
  const settings = createSettingsAuthority(local, sync, createMirrorConfigId);
  const observedXCache = createObservedXCache(local, cacheUuid);
  const collections = createCollections(local, openCollectionStore);

  const readFilter = async (defaultLanguages: readonly string[]): Promise<FilterState> => {
    const defaults = defaultFilterState(defaultLanguages);
    const raw = (await sync.get(STORAGE_KEYS.filter))[STORAGE_KEYS.filter];
    return normalizeFilterState(raw, defaults);
  };
  const commandFilter = async (
    command: FilterCommand,
    defaultLanguages: readonly string[],
  ): Promise<FilterState> => {
    // This read is intentionally inside the shared queue. A command observes
    // every accepted predecessor, including one from another extension context.
    const before = await readFilter(defaultLanguages);
    const after = applyFilterCommand(before, command);
    await sync.set({ [STORAGE_KEYS.filter]: after });
    return after;
  };
  const runCoach = async (command: CoachCommand): Promise<CoachCommandResult> => {
    if (!isCoachCommand(command)) throw new Error("Invalid coach command");
    const raw = (await local.get(STORAGE_KEYS.coach))[STORAGE_KEYS.coach];
    const clock = Date.now();
    const now = Number.isSafeInteger(clock) && clock >= 0 ? clock : 0;
    const transition = transitionCoach(raw, command, now);
    if (transition.changed) await local.set({ [STORAGE_KEYS.coach]: transition.stored });
    return transition.result;
  };
  const listUsage = async (request: ListUsageRequest): Promise<ListUsageSuccess> => {
    const prefix = `${LIST_USAGE_PREFIX}${encodeURIComponent(request.ownerUserId)}`;
    if (request.operation === "record") {
      const key = `${prefix}:${encodeURIComponent(request.listId)}`;
      const prior = (await local.get(key))[key];
      const now = Date.now();
      const stamp = Number.isSafeInteger(now) && now >= 0 ? now : 0;
      await local.set({
        [key]:
          typeof prior === "number" && Number.isSafeInteger(prior) && prior >= stamp
            ? prior
            : stamp,
      });
      return {};
    }
    const items = await local.get(null);
    const listIds = Object.entries(items)
      .filter(
        ([key, value]) =>
          key.startsWith(`${prefix}:`) &&
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0,
      )
      .map(([key, value]) => {
        const encoded = key.slice(prefix.length + 1);
        try {
          const listId = decodeURIComponent(encoded);
          return encodeURIComponent(listId) === encoded ? { listId, at: value as number } : null;
        } catch {
          return null;
        }
      })
      .filter((row): row is { listId: string; at: number } => row !== null)
      .filter((row) => /^[1-9][0-9]{0,63}$/.test(row.listId))
      // oxlint-disable-next-line unicorn/no-array-sort -- fresh owned array; Chrome 106 lacks toSorted().
      .sort((a, b) => b.at - a.at || a.listId.localeCompare(b.listId))
      .slice(0, request.limit)
      .map((row) => row.listId);
    return { listIds };
  };
  const mirrorStatus = async (request: MirrorStatusRequest): Promise<MirrorStatusSuccess> => {
    if (request.operation === "read") {
      return {
        status: parseMirrorStatus(
          (await local.get(STORAGE_KEYS.mirrorStatus))[STORAGE_KEYS.mirrorStatus],
        ),
      };
    }
    const current = await settings.read();
    if (current.mirrorConfigId !== request.configId) return {};
    const now = Date.now();
    await local.set({
      [STORAGE_KEYS.mirrorStatus]: {
        ok: request.ok,
        configId: request.configId,
        at: Number.isSafeInteger(now) && now >= 0 ? now : 0,
      },
    });
    return {};
  };

  return {
    migrate: () => serialize(settings.migrate),
    readSettings: () => serialize(settings.read),
    patchSettings: (patch) => serialize(() => settings.patch(patch)),
    readFilter: (defaultLanguages) => serialize(() => readFilter(defaultLanguages)),
    commandFilter: (command, defaultLanguages) =>
      serialize(() => commandFilter(command, defaultLanguages)),
    runCoach: (command) => serialize(() => runCoach(command)),
    listCache: (request) => serialize(() => observedXCache.listCache(request)),
    listUsage: (request) => serialize(() => listUsage(request)),
    mirrorStatus: (request) => serialize(() => mirrorStatus(request)),
    graphqlCatalog: (request) => serialize(() => observedXCache.graphqlCatalog(request)),
    collections: (request) => serialize(() => collections(request)),
    clear: () => serialize(() => erasePrivateData(local, sync, cacheUuid)),
  };
}
