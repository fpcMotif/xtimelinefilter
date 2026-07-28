import {
  beginCacheObservation,
  decideCacheObservation,
  normalizeCacheObservation,
  normalizeCacheObservationClock,
} from "@/core/cache-observation";
import {
  MAX_LIVE_FOLDERS,
  type CollectionsRequest,
  type CollectionsSuccess,
} from "@/core/protocol/collections";
import type { StorageLike } from "@/core/storage-areas";
import { COLLECTIONS_DATABASE, STORAGE_KEYS } from "@/core/storage-keys";
import type { CollectionStore } from "@/packages/folders/types";

/** Builds the one store this worker will ever own. Tests substitute an in-memory one. */
export type CollectionStoreFactory = () => Promise<CollectionStore>;

/** Destroys the collections database. True only when it is really gone. */
export type DatabaseDestroyer = () => Promise<boolean>;

/** Raised when the database cannot be opened, so no caller is told a save landed. */
class CollectionsUnavailableError extends Error {
  constructor() {
    super("Folders are unavailable: the collections database could not be opened.");
  }
}

/** Raised when a caller would push past the declared live-Folder cap. */
class FolderLimitError extends Error {
  constructor() {
    super(`You can have at most ${MAX_LIVE_FOLDERS} folders.`);
  }
}

/**
 * The worker's Folders authority. It owns the single `CollectionStore` — no
 * other context opens the database — and every operation here runs inside the
 * caller's serialized storage queue, so a collections write cannot interleave
 * with a Settings patch, a migration or Privacy Clear.
 *
 * Writes are fenced by the same observation clock the List and GraphQL caches
 * use: a token minted before Clear has a rotated epoch afterwards and is
 * refused, so a save the user began before wiping their data cannot land after
 * it. Reads are unfenced — stale data read is harmless, stale data written is
 * not.
 *
 * Nothing here reads an X account from any source, and nothing passes one to the
 * store. The only account that reaches the database is the `xAccountId` a
 * bookmark-evidence write carries as part of its own observation.
 */
export function createCollections(
  local: StorageLike,
  openStore: CollectionStoreFactory,
  destroyDatabase: DatabaseDestroyer = defaultDatabaseDestroyer,
) {
  // MV3 kills the worker; the store is reopened lazily on the next operation and
  // a failed open is not cached, so a transient failure can recover.
  let pending: Promise<CollectionStore> | null = null;
  const store = async (): Promise<CollectionStore> => {
    pending ??= openStore().catch(() => {
      pending = null;
      throw new CollectionsUnavailableError();
    });
    return pending;
  };

  const clock = async () =>
    normalizeCacheObservationClock(
      (await local.get(STORAGE_KEYS.cacheObservation))[STORAGE_KEYS.cacheObservation],
      // The clock only ever needs generating here when nothing has minted one;
      // callers mint through `begin`, which persists it.
      () => crypto.randomUUID(),
    );

  const issueToken = async () => {
    const raw = (await local.get(STORAGE_KEYS.cacheObservation))[STORAGE_KEYS.cacheObservation];
    const next = beginCacheObservation(raw, () => crypto.randomUUID());
    await local.set({ [STORAGE_KEYS.cacheObservation]: next.clock });
    return next.observation;
  };

  /** A write whose epoch has rotated began before a Clear and must not land. */
  const fenced = async (token: unknown): Promise<boolean> =>
    decideCacheObservation(await clock(), undefined, normalizeCacheObservation(token)) !== "write";

  const liveFolderCount = async (): Promise<number> => (await store()).countFolders();

  /**
   * Privacy Clear's leg. The open connection is released first — it would
   * otherwise block the delete indefinitely — and the memoized store is dropped
   * so the next operation reopens a fresh, empty database. Reports whether the
   * database is actually gone, because Options tells the user "could not clear
   * all data" on anything less.
   */
  const destroy = async (): Promise<boolean> => {
    const opened = pending;
    pending = null;
    if (opened) {
      // A failure to close is not the verdict — deleteDatabase is. If the
      // connection really is stuck open, the delete reports `blocked` and Clear
      // says so; treating a close error as the answer would report a failure
      // even when the database went away cleanly.
      await opened.then(
        (db) => {
          try {
            db.close();
          } catch {
            // Swallowed on purpose: deleteDatabase below is the verdict.
          }
        },
        () => undefined,
      );
    }
    return destroyDatabase();
  };

  const run = async function collections(request: CollectionsRequest): Promise<CollectionsSuccess> {
    if (request.operation === "begin") return { token: await issueToken() };
    if ("token" in request && (await fenced(request.token))) {
      throw new Error("This change was started before your data was cleared, so it was discarded.");
    }

    const db = await store();
    switch (request.operation) {
      case "list-folders":
        return { folders: await db.listFolders({ includeDeleted: request.includeDeleted }) };
      case "folders-holding":
        return { folderIds: await db.foldersHolding({ statusId: request.statusId }) };
      case "create-folder": {
        // Checked here rather than in the store: the cap is a product limit the
        // protocol declares, and Options disables its control at the same number.
        if ((await liveFolderCount()) >= MAX_LIVE_FOLDERS) throw new FolderLimitError();
        return { folder: await db.createFolder({ name: request.name }) };
      }
      case "rename-folder":
        await db.renameFolder({ folderId: request.folderId, name: request.name });
        return {};
      case "reorder-folders":
        await db.reorderFolders({ folderIds: request.folderIds });
        return {};
      case "delete-folder":
        await db.deleteFolder({
          folderId: request.folderId,
          disposition: request.disposition,
        });
        return {};
      case "save-post":
        return {
          outcome: await db.savePost({ folderId: request.folderId, capture: request.capture }),
        };
      case "remove-from-folder":
        await db.removeFromFolder({ folderId: request.folderId, statusId: request.statusId });
        return {};
      case "delete-saved-post":
        await db.deleteSavedPost({ statusId: request.statusId });
        return {};
      case "get-saved-post":
        return { post: await db.getSavedPost({ statusId: request.statusId }) };
      case "set-note":
        await db.setNote({ statusId: request.statusId, note: request.note });
        return {};
      case "set-tags":
        await db.setTags({ statusId: request.statusId, tags: request.tags });
        return {};
      case "record-bookmark-evidence":
        await db.recordBookmarkEvidence({
          statusId: request.statusId,
          xAccountId: request.xAccountId,
          outcome: request.outcome,
          observedAt: request.observedAt,
        });
        return {};
      case "list-bookmark-evidence":
        return { evidence: await db.listBookmarkEvidence({ statusId: request.statusId }) };
      case "count-folder":
        return { count: await db.countFolder({ folderId: request.folderId }) };
      case "counts":
        return {
          counts: {
            folders: await liveFolderCount(),
            savedPosts: await db.countSavedPosts(),
          },
        };
      case "read-folder-page":
        return {
          page: await db.readFolderPage({
            folderId: request.folderId,
            limit: request.limit,
            cursor: request.cursor,
          }),
        };
    }
  };

  return { run, destroy };
}

/**
 * Production's store: the local-first IndexedDB database, opened once. The
 * browser globals are read HERE and nowhere else, so the folders package stays
 * headless and every other context keeps its hands off the database.
 */
export const defaultCollectionStore: CollectionStoreFactory = async () => {
  const { createCollectionStore } = await import("@/packages/folders");
  // Read off globalThis, never as bare identifiers: an absent global is then
  // `undefined` and the factory degrades to the inert store, where a bare
  // reference would throw a ReferenceError and take the worker down with it.
  return createCollectionStore({
    indexedDB: globalThis.indexedDB,
    keyRange: globalThis.IDBKeyRange,
  });
};

/**
 * Deletes the worker-owned database. A `blocked` event means some connection is
 * still open, which would hang the delete — so it resolves false and Clear
 * reports honestly rather than waiting forever on a promise that never settles.
 */
export const defaultDatabaseDestroyer: DatabaseDestroyer = () =>
  new Promise<boolean>((resolve) => {
    const factory = globalThis.indexedDB;
    if (!factory) return resolve(true);
    const request = factory.deleteDatabase(COLLECTIONS_DATABASE);
    request.addEventListener("success", () => resolve(true));
    request.addEventListener("error", () => resolve(false));
    request.addEventListener("blocked", () => resolve(false));
  });
