import type {
  BookmarkEvidence,
  CollectionStore,
  CountFolderParams,
  CreateFolderParams,
  DeleteFolderParams,
  DeleteSavedPostParams,
  Folder,
  FolderMembership,
  FolderPage,
  GetSavedPostParams,
  ListBookmarkEvidenceParams,
  ListFoldersParams,
  PostCapture,
  ReadFolderPageParams,
  RecordBookmarkEvidenceParams,
  RemoveFromFolderParams,
  RenameFolderParams,
  ReorderFoldersParams,
  SaveOutcome,
  SavePostParams,
  SavedPost,
  SetNoteParams,
  SetTagsParams,
} from "../types";
import { mintFolderId } from "./ids";
import {
  applySchema,
  Indexes,
  SAVED_POSTS_DB_NAME,
  SAVED_POSTS_DB_VERSION,
  Stores,
} from "./schema";

/** Tags are user-typed; bound them so one post can't grow without limit. */
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 48;

/**
 * Resolves when the whole transaction commits, rejects if it aborts. Individual
 * requests carry no error handler on purpose: a failed request aborts its
 * transaction, so one rejection path covers every operation inside it, and a
 * request's `result` is readable once the transaction has completed.
 */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener("complete", () => resolve());
    tx.addEventListener("abort", () => reject(tx.error));
  });
}

export function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(SAVED_POSTS_DB_NAME, SAVED_POSTS_DB_VERSION);
    req.addEventListener("upgradeneeded", () => applySchema(req.result));
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
}

/** Opaque, store-minted page cursor: the last row's position in the folder index. */
function encodeCursor(row: FolderMembership): string {
  return `${row.addedAt}:${row.statusId}`;
}

function decodeCursor(
  raw: string | null | undefined,
): { addedAt: number; statusId: string } | null {
  if (!raw) return null;
  const split = raw.indexOf(":");
  if (split < 0) return null;
  const addedAt = Number(raw.slice(0, split));
  return Number.isFinite(addedAt) ? { addedAt, statusId: raw.slice(split + 1) } : null;
}

function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** A capture becomes a Saved Post once; optional parts absent stay absent. */
function toSavedPost(capture: PostCapture, statusId: string, capturedAt: number): SavedPost {
  return {
    statusId,
    permalink: capture.permalink,
    ...(capture.author ? { author: capture.author } : {}),
    ...(capture.text ? { text: capture.text } : {}),
    media: capture.media,
    ...(capture.postedAt ? { postedAt: capture.postedAt } : {}),
    capturedAt,
    note: "",
    tags: [],
  };
}

/**
 * The local-first home for Folders and Saved Posts, and the authority the
 * optional Destinations sync FROM. Takes its `IDBFactory` and `IDBKeyRange` as
 * arguments rather than reaching for globals, so it is drivable under the test
 * environment and carries no assumption about where it runs.
 *
 * No operation takes an account. The only account this class ever writes is the
 * `xAccountId` on a bookmark-evidence row.
 */
export class LocalCollectionStore implements CollectionStore {
  constructor(
    private readonly db: IDBDatabase,
    private readonly keyRange: typeof IDBKeyRange,
  ) {}

  private tx(stores: string[], mode: IDBTransactionMode): IDBTransaction {
    return this.db.transaction(stores, mode);
  }

  /**
   * Every key that begins with this Folder id — which covers both the membership
   * primary key `[folderId, statusId]` and the `by-folder-added` index key
   * `[folderId, addedAt, statusId]`. `after` resumes a page just past a cursor.
   */
  private folderKeys(folderId: string, after?: { addedAt: number; statusId: string }): IDBKeyRange {
    const lower = after ? [folderId, after.addedAt, after.statusId] : [folderId];
    // An array sorts after every scalar, so `[folderId, []]` bounds the folder.
    return this.keyRange.bound(lower, [folderId, []], !!after, false);
  }

  async createFolder({ name }: CreateFolderParams): Promise<Folder> {
    const tx = this.tx([Stores.FOLDERS], "readwrite");
    const store = tx.objectStore(Stores.FOLDERS);
    const now = Date.now();
    const folder: Folder = {
      folderId: mintFolderId(),
      name,
      sortIndex: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const countReq = store.count();
    countReq.onsuccess = () => {
      folder.sortIndex = countReq.result;
      store.put(folder);
    };
    await txDone(tx);
    return folder;
  }

  async listFolders({ includeDeleted }: ListFoldersParams): Promise<Folder[]> {
    const tx = this.tx([Stores.FOLDERS], "readonly");
    const req = tx.objectStore(Stores.FOLDERS).index(Indexes.FOLDERS_BY_SORT).getAll();
    await txDone(tx);
    const all = req.result as Folder[];
    return includeDeleted ? all : all.filter((f) => f.deletedAt === null);
  }

  async renameFolder({ folderId, name }: RenameFolderParams): Promise<void> {
    const tx = this.tx([Stores.FOLDERS], "readwrite");
    const store = tx.objectStore(Stores.FOLDERS);
    const req = store.get(folderId);
    req.onsuccess = () => {
      const folder = req.result as Folder | undefined;
      if (folder) store.put({ ...folder, name, updatedAt: Date.now() });
    };
    await txDone(tx);
  }

  async reorderFolders({ folderIds }: ReorderFoldersParams): Promise<void> {
    const tx = this.tx([Stores.FOLDERS], "readwrite");
    const store = tx.objectStore(Stores.FOLDERS);
    const req = store.index(Indexes.FOLDERS_BY_SORT).getAll();
    req.onsuccess = () => {
      const all = req.result as Folder[];
      // Named folders take the front in the given order; the rest keep their
      // relative order behind them. An unknown id contributes nothing.
      const named = folderIds
        .map((id) => all.find((f) => f.folderId === id))
        .filter((f): f is Folder => !!f);
      const rest = all.filter((f) => !folderIds.includes(f.folderId));
      const now = Date.now();
      [...named, ...rest].forEach((folder, sortIndex) => {
        store.put({ ...folder, sortIndex, updatedAt: now });
      });
    };
    await txDone(tx);
  }

  async deleteFolder({ folderId, disposition }: DeleteFolderParams): Promise<void> {
    const tx = this.tx(
      [Stores.FOLDERS, Stores.FOLDER_MEMBERSHIPS, Stores.SAVED_POSTS, Stores.BOOKMARK_EVIDENCE],
      "readwrite",
    );
    const folders = tx.objectStore(Stores.FOLDERS);
    const memberships = tx.objectStore(Stores.FOLDER_MEMBERSHIPS);

    const folderReq = folders.get(folderId);
    folderReq.onsuccess = () => {
      const folder = folderReq.result as Folder | undefined;
      if (folder) {
        const now = Date.now();
        folders.put({ ...folder, deletedAt: now, updatedAt: now });
      }
    };

    // Which posts were in here, as KEYS — never the records themselves, so a
    // folder of any size costs one small read rather than loading it all.
    const heldReq = memberships.index(Indexes.MEMBERSHIPS_BY_FOLDER).getAllKeys(folderId);
    // One ranged delete drops every row of this folder, whatever its size.
    memberships.delete(this.folderKeys(folderId));
    heldReq.onsuccess = () => {
      if (disposition !== "delete-orphaned-posts") return;
      // Placed after the ranged delete above, and IDB runs a transaction's
      // requests in placement order — so "still held" means held ELSEWHERE.
      for (const key of heldReq.result) {
        const statusId = (key as [string, string])[1];
        const stillHeldReq = memberships.index(Indexes.MEMBERSHIPS_BY_STATUS).count(statusId);
        stillHeldReq.onsuccess = () => {
          if (stillHeldReq.result === 0) this.purgePost(tx, statusId);
        };
      }
    };
    await txDone(tx);
  }

  /**
   * Removes a post and its evidence. Membership rows are the CALLER's to clear,
   * because the two callers reach this point differently: `deleteFolder` has
   * already dropped the folder's rows and purges only what nothing else holds,
   * while `deleteSavedPost` clears every row for the post outright.
   */
  private purgePost(tx: IDBTransaction, statusId: string): void {
    tx.objectStore(Stores.SAVED_POSTS).delete(statusId);
    const evidence = tx.objectStore(Stores.BOOKMARK_EVIDENCE);
    const keysReq = evidence.index(Indexes.EVIDENCE_BY_STATUS).getAllKeys(statusId);
    keysReq.onsuccess = () => {
      for (const key of keysReq.result) evidence.delete(key);
    };
  }

  async savePost({ folderId, capture }: SavePostParams): Promise<SaveOutcome> {
    const statusId = capture.statusId;
    // Rejected at the boundary: nothing is stored under a substituted id.
    if (!statusId) return { status: "unsavable" };

    const tx = this.tx([Stores.SAVED_POSTS, Stores.FOLDER_MEMBERSHIPS], "readwrite");
    const posts = tx.objectStore(Stores.SAVED_POSTS);
    const memberships = tx.objectStore(Stores.FOLDER_MEMBERSHIPS);
    let outcome: SaveOutcome = { status: "saved", statusId };

    // Each handler reads only its OWN request, so nothing here depends on the
    // order two requests were placed in — the filing decision is nested inside
    // the answer it depends on rather than racing beside it.
    const rowReq = memberships.get([folderId, statusId]);
    rowReq.onsuccess = () => {
      if (rowReq.result) {
        // Already there: a harmless no-op that keeps captured-at, note and tags.
        outcome = { status: "already-there", statusId };
        return;
      }
      const postReq = posts.get(statusId);
      postReq.onsuccess = () => {
        const now = Date.now();
        // One post is one Saved Post: a second Folder adds a row, never a copy.
        if (!postReq.result) posts.put(toSavedPost(capture, statusId, now));
        memberships.put({ folderId, statusId, addedAt: now });
      };
    };
    await txDone(tx);
    return outcome;
  }

  async removeFromFolder({ folderId, statusId }: RemoveFromFolderParams): Promise<void> {
    const tx = this.tx([Stores.FOLDER_MEMBERSHIPS], "readwrite");
    tx.objectStore(Stores.FOLDER_MEMBERSHIPS).delete([folderId, statusId]);
    await txDone(tx);
  }

  async deleteSavedPost({ statusId }: DeleteSavedPostParams): Promise<void> {
    const tx = this.tx(
      [Stores.SAVED_POSTS, Stores.FOLDER_MEMBERSHIPS, Stores.BOOKMARK_EVIDENCE],
      "readwrite",
    );
    const memberships = tx.objectStore(Stores.FOLDER_MEMBERSHIPS);
    const keysReq = memberships.index(Indexes.MEMBERSHIPS_BY_STATUS).getAllKeys(statusId);
    keysReq.onsuccess = () => {
      for (const key of keysReq.result) memberships.delete(key);
    };
    this.purgePost(tx, statusId);
    await txDone(tx);
  }

  async getSavedPost({ statusId }: GetSavedPostParams): Promise<SavedPost | null> {
    const tx = this.tx([Stores.SAVED_POSTS], "readonly");
    const req = tx.objectStore(Stores.SAVED_POSTS).get(statusId);
    await txDone(tx);
    return (req.result as SavedPost | undefined) ?? null;
  }

  async setNote({ statusId, note }: SetNoteParams): Promise<void> {
    await this.patchPost(statusId, (post) => ({ ...post, note }));
  }

  async setTags({ statusId, tags }: SetTagsParams): Promise<void> {
    await this.patchPost(statusId, (post) => ({ ...post, tags: normalizeTags(tags) }));
  }

  /** Touches the post record only — never a Folder row, never evidence. */
  private async patchPost(statusId: string, patch: (post: SavedPost) => SavedPost): Promise<void> {
    const tx = this.tx([Stores.SAVED_POSTS], "readwrite");
    const store = tx.objectStore(Stores.SAVED_POSTS);
    const req = store.get(statusId);
    req.onsuccess = () => {
      const post = req.result as SavedPost | undefined;
      if (post) store.put(patch(post));
    };
    await txDone(tx);
  }

  async recordBookmarkEvidence(params: RecordBookmarkEvidenceParams): Promise<void> {
    // Only the evidence store is in this transaction, so an evidence write
    // cannot create a Saved Post or a Folder row even by mistake.
    const tx = this.tx([Stores.BOOKMARK_EVIDENCE], "readwrite");
    tx.objectStore(Stores.BOOKMARK_EVIDENCE).put({ ...params });
    await txDone(tx);
  }

  async listBookmarkEvidence({
    statusId,
  }: ListBookmarkEvidenceParams): Promise<BookmarkEvidence[]> {
    const tx = this.tx([Stores.BOOKMARK_EVIDENCE], "readonly");
    const req = tx
      .objectStore(Stores.BOOKMARK_EVIDENCE)
      .index(Indexes.EVIDENCE_BY_STATUS)
      .getAll(statusId);
    await txDone(tx);
    return req.result as BookmarkEvidence[];
  }

  async countFolder({ folderId }: CountFolderParams): Promise<number> {
    const tx = this.tx([Stores.FOLDER_MEMBERSHIPS], "readonly");
    const req = tx
      .objectStore(Stores.FOLDER_MEMBERSHIPS)
      .index(Indexes.MEMBERSHIPS_BY_FOLDER)
      .count(folderId);
    await txDone(tx);
    return req.result;
  }

  async countSavedPosts(): Promise<number> {
    // savedPosts is keyed by statusId, so its size IS the distinct total.
    const tx = this.tx([Stores.SAVED_POSTS], "readonly");
    const req = tx.objectStore(Stores.SAVED_POSTS).count();
    await txDone(tx);
    return req.result;
  }

  async readFolderPage({ folderId, limit, cursor }: ReadFolderPageParams): Promise<FolderPage> {
    const after = decodeCursor(cursor);
    const tx = this.tx([Stores.FOLDER_MEMBERSHIPS, Stores.SAVED_POSTS], "readonly");
    const posts = tx.objectStore(Stores.SAVED_POSTS);
    const rows: FolderMembership[] = [];
    const found: SavedPost[] = [];

    const cursorReq = tx
      .objectStore(Stores.FOLDER_MEMBERSHIPS)
      .index(Indexes.MEMBERSHIPS_BY_FOLDER_ADDED)
      .openCursor(this.folderKeys(folderId, after ?? undefined));
    cursorReq.onsuccess = () => {
      const indexCursor = cursorReq.result;
      if (!indexCursor) return;
      const row = indexCursor.value as FolderMembership;
      rows.push(row);
      const postReq = posts.get(row.statusId);
      postReq.onsuccess = () => {
        /* v8 ignore next -- a row always has its post: every path that deletes a
           post deletes its rows in the same transaction. Type-required guard. */
        if (postReq.result) found.push(postReq.result as SavedPost);
      };
      if (rows.length < limit) indexCursor.continue();
    };
    await txDone(tx);

    const last = rows[rows.length - 1];
    return { posts: found, nextCursor: last && rows.length === limit ? encodeCursor(last) : null };
  }
}
