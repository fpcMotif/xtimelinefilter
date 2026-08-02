/**
 * The local database's declared shape. A test asserts the live database against
 * these literals — any extra store, key path or index fails it.
 *
 * The public key layout is the feature's saved-once invariant made physical:
 *
 *   savedPosts        keyed by  statusId
 *   folderMemberships keyed by  [folderId, statusId]
 *   bookmarkEvidence  keyed by  [statusId, xAccountId]   ← the ONLY key naming an account
 *
 * Replica stores are private worker metadata. Their composite key starts with a
 * configuration id, never an X account or Chrome-profile identifier.
 */
export const FOLDERS_DB_NAME = "lasso:folders";
export const FOLDERS_DB_VERSION = 2;

export const Stores = {
  FOLDERS: "folders",
  SAVED_POSTS: "savedPosts",
  FOLDER_MEMBERSHIPS: "folderMemberships",
  BOOKMARK_EVIDENCE: "bookmarkEvidence",
  REPLICA_ENTITY_STATE: "replicaEntityState",
  REPLICA_OUTBOX: "replicaOutbox",
  REPLICA_STATUS: "replicaStatus",
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

function createCollectionStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(Stores.FOLDERS)) {
    const folders = db.createObjectStore(Stores.FOLDERS, { keyPath: "folderId" });
    folders.createIndex(Indexes.FOLDERS_BY_SORT, "sortIndex");
    folders.createIndex(Indexes.FOLDERS_BY_DELETED, "deletedAt");
  }

  if (!db.objectStoreNames.contains(Stores.SAVED_POSTS)) {
    db.createObjectStore(Stores.SAVED_POSTS, { keyPath: "statusId" });
  }

  if (!db.objectStoreNames.contains(Stores.FOLDER_MEMBERSHIPS)) {
    const memberships = db.createObjectStore(Stores.FOLDER_MEMBERSHIPS, {
      keyPath: ["folderId", "statusId"],
    });
    memberships.createIndex(Indexes.MEMBERSHIPS_BY_FOLDER, "folderId");
    memberships.createIndex(Indexes.MEMBERSHIPS_BY_FOLDER_ADDED, [
      "folderId",
      "addedAt",
      "statusId",
    ]);
    memberships.createIndex(Indexes.MEMBERSHIPS_BY_STATUS, "statusId");
  }

  if (!db.objectStoreNames.contains(Stores.BOOKMARK_EVIDENCE)) {
    const evidence = db.createObjectStore(Stores.BOOKMARK_EVIDENCE, {
      keyPath: ["statusId", "xAccountId"],
    });
    evidence.createIndex(Indexes.EVIDENCE_BY_STATUS, "statusId");
  }
}

function createReplicaStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(Stores.REPLICA_ENTITY_STATE)) {
    db.createObjectStore(Stores.REPLICA_ENTITY_STATE, {
      keyPath: ["configurationId", "key"],
    });
  }
  if (!db.objectStoreNames.contains(Stores.REPLICA_OUTBOX)) {
    db.createObjectStore(Stores.REPLICA_OUTBOX, {
      keyPath: ["configurationId", "key"],
    });
  }
  if (!db.objectStoreNames.contains(Stores.REPLICA_STATUS)) {
    db.createObjectStore(Stores.REPLICA_STATUS, { keyPath: "configurationId" });
  }
}

/** Creates every store and index. Runs inside `onupgradeneeded`. */
export function applySchema(db: IDBDatabase): void {
  createCollectionStores(db);
  createReplicaStores(db);
}
