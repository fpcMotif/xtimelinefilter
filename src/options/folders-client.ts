import type { CacheObservation } from "@/core/cache-observation";
import {
  requestCollections,
  type CollectionCounts,
  type FolderCounts,
} from "@/core/protocol/collections";
import { hasWorkerTransport } from "@/core/worker-transport";
import type { Folder, FolderDisposition, FolderPage } from "@/packages/folders/types";

/**
 * The Options page's door to Folders — the workshop's narrow surface over the
 * `lasso:collections` family. Unlike `src/content/collections-client.ts`
 * (which the timeline's save gesture uses and which the worker grants only a
 * handful of operations), Options may submit every operation in the family;
 * this client exposes the ones the Folders workshop actually renders: list,
 * create, rename, reorder, delete, and the two count reads a Folder row and
 * its delete confirmation need.
 *
 * No method takes an account — a Folder has no Owner, so nothing here has
 * anywhere to put one.
 */
export interface FoldersClient {
  /** Live (non-deleted) Folders, in the user's chosen order. */
  listFolders(): Promise<Folder[]>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(folderId: string, name: string): Promise<void>;
  /** The new order. A Folder absent from the list keeps its relative position. */
  reorderFolders(folderIds: string[]): Promise<void>;
  deleteFolder(folderId: string, disposition: FolderDisposition): Promise<void>;
  /** This Folder's membership count — O(1), cheap enough for every row. */
  countFolder(folderId: string): Promise<number>;
  /**
   * The same count, plus how many of those posts another live Folder also
   * holds — O(posts-in-folder). The delete confirmation is its sole consumer;
   * nothing else may call this per row.
   */
  countFolderForDelete(folderId: string): Promise<FolderCounts>;
  /** The deduped, global summary: live Folder count and distinct Saved-Post total. */
  counts(): Promise<CollectionCounts>;
  /** One bounded page of a Folder's Saved Posts. `cursor` null for the first page. */
  readFolderPage(folderId: string, limit: number, cursor: string | null): Promise<FolderPage>;
}

const TYPE = "lasso:collections";

/** A fence minted per write, exactly like the content-script client. */
async function token(): Promise<CacheObservation> {
  const response = (await requestCollections({ type: TYPE, operation: "begin" })) as {
    token: CacheObservation;
  };
  return response.token;
}

/**
 * What a non-extension host gets instead of a wire error — no chrome.runtime
 * to send through, so every read answers empty or zero and every write is a
 * harmless no-op. Mirrors `NullCollectionStore`'s own philosophy (ADR-0013):
 * a host with no database behaves as if the feature were absent, never
 * broken. Production Options always has a real runtime; this path exists for
 * tests and the design-card generator, which render `OptionsApp` bare.
 */
function createInertFoldersClient(): FoldersClient {
  return {
    async listFolders() {
      return [];
    },
    async createFolder(name) {
      const now = Date.now();
      return {
        folderId: "fld_00000000000000000000",
        name,
        sortIndex: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
    },
    async renameFolder() {},
    async reorderFolders() {},
    async deleteFolder() {},
    async countFolder() {
      return 0;
    },
    async countFolderForDelete() {
      return { count: 0, shared: 0 };
    },
    async counts() {
      return { folders: 0, savedPosts: 0 };
    },
    async readFolderPage() {
      return { posts: [], nextCursor: null };
    },
  };
}

function createWorkerFoldersClient(): FoldersClient {
  return {
    async listFolders() {
      const response = (await requestCollections({
        type: TYPE,
        operation: "list-folders",
        includeDeleted: false,
      })) as { folders: Folder[] };
      return response.folders;
    },

    async createFolder(name) {
      const response = (await requestCollections({
        type: TYPE,
        operation: "create-folder",
        name,
        token: await token(),
      })) as { folder: Folder };
      return response.folder;
    },

    async renameFolder(folderId, name) {
      await requestCollections({
        type: TYPE,
        operation: "rename-folder",
        folderId,
        name,
        token: await token(),
      });
    },

    async reorderFolders(folderIds) {
      await requestCollections({
        type: TYPE,
        operation: "reorder-folders",
        folderIds,
        token: await token(),
      });
    },

    async deleteFolder(folderId, disposition) {
      await requestCollections({
        type: TYPE,
        operation: "delete-folder",
        folderId,
        disposition,
        token: await token(),
      });
    },

    async countFolder(folderId) {
      const response = (await requestCollections({
        type: TYPE,
        operation: "count-folder",
        folderId,
      })) as { count: number };
      return response.count;
    },

    async countFolderForDelete(folderId) {
      const response = (await requestCollections({
        type: TYPE,
        operation: "count-folder-shared",
        folderId,
      })) as FolderCounts;
      return { count: response.count, shared: response.shared };
    },

    async counts() {
      const response = (await requestCollections({ type: TYPE, operation: "counts" })) as {
        counts: CollectionCounts;
      };
      return response.counts;
    },

    async readFolderPage(folderId, limit, cursor) {
      const response = (await requestCollections({
        type: TYPE,
        operation: "read-folder-page",
        folderId,
        limit,
        cursor,
      })) as { page: FolderPage };
      return response.page;
    },
  };
}

export function createFoldersClient(): FoldersClient {
  return hasWorkerTransport() ? createWorkerFoldersClient() : createInertFoldersClient();
}
