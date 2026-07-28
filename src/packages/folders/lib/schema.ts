/**
 * The local database's declared shape. A test asserts the live database against
 * these literals — any extra store, key path or index fails it.
 *
 * The key layout is the feature's saved-once invariant made physical:
 *
 *   savedPosts        keyed by  statusId
 *   folderMemberships keyed by  [folderId, statusId]
 *   bookmarkEvidence  keyed by  [statusId, xAccountId]   ← the ONLY key naming an account
 */
export const FOLDERS_DB_NAME = "lasso:folders";
export const FOLDERS_DB_VERSION = 1;

export const Stores = {
  FOLDERS: "folders",
  SAVED_POSTS: "savedPosts",
  FOLDER_MEMBERSHIPS: "folderMemberships",
  BOOKMARK_EVIDENCE: "bookmarkEvidence",
} as const;

export const Indexes = {
  /** Folders in user-chosen order. */
  FOLDERS_BY_SORT: "by-sort",
  /**
   * TOMBSTONES ONLY. `null` is not a valid IndexedDB key, so a live Folder is
   * absent from this index — which makes the live count `store.count()` minus
   * this index's count, two index-backed reads rather than a scan.
   */
  FOLDERS_BY_DELETED: "by-deleted",
  /** Plain folderId — backs countFolder() with no range. */
  MEMBERSHIPS_BY_FOLDER: "by-folder",
  /** Ordered paging within one Folder; statusId makes the key unique. */
  MEMBERSHIPS_BY_FOLDER_ADDED: "by-folder-added",
  /** Every Folder holding one post — backs orphan checks and cascades. */
  MEMBERSHIPS_BY_STATUS: "by-status",
  EVIDENCE_BY_STATUS: "by-status",
} as const;

/** Creates every store and index. Runs inside `onupgradeneeded`. */
export function applySchema(db: IDBDatabase): void {
  const folders = db.createObjectStore(Stores.FOLDERS, { keyPath: "folderId" });
  folders.createIndex(Indexes.FOLDERS_BY_SORT, "sortIndex");
  folders.createIndex(Indexes.FOLDERS_BY_DELETED, "deletedAt");

  db.createObjectStore(Stores.SAVED_POSTS, { keyPath: "statusId" });

  const memberships = db.createObjectStore(Stores.FOLDER_MEMBERSHIPS, {
    keyPath: ["folderId", "statusId"],
  });
  memberships.createIndex(Indexes.MEMBERSHIPS_BY_FOLDER, "folderId");
  memberships.createIndex(Indexes.MEMBERSHIPS_BY_FOLDER_ADDED, ["folderId", "addedAt", "statusId"]);
  memberships.createIndex(Indexes.MEMBERSHIPS_BY_STATUS, "statusId");

  const evidence = db.createObjectStore(Stores.BOOKMARK_EVIDENCE, {
    keyPath: ["statusId", "xAccountId"],
  });
  evidence.createIndex(Indexes.EVIDENCE_BY_STATUS, "statusId");
}
