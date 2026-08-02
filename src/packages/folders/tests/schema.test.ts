import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createCollectionStore, FOLDERS_DB_NAME, FOLDERS_DB_VERSION } from "../index";

/**
 * object store, key path or index — under any name — fails this. Public
 * collection records stay account-free: `bookmarkEvidence` is the sole public
 * record whose key contains `xAccountId`; replica metadata is configuration-
 * scoped and never keys an account, Owner, or Chrome profile.
 */

/** Opens the database the store just created, without going through the store. */
async function openCreatedDatabase(): Promise<IDBDatabase> {
  const indexedDB = new IDBFactory();
  await createCollectionStore({ indexedDB, keyRange: IDBKeyRange });
  return new Promise<IDBDatabase>((resolve) => {
    const req = indexedDB.open(FOLDERS_DB_NAME, FOLDERS_DB_VERSION);
    req.onsuccess = () => resolve(req.result as unknown as IDBDatabase);
  });
}

async function seedVersionOneDatabase(indexedDB: IDBFactory): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(FOLDERS_DB_NAME, 1);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      const folders = db.createObjectStore("folders", { keyPath: "folderId" });
      folders.createIndex("by-sort", "sortIndex");
      folders.createIndex("by-deleted", "deletedAt");
      db.createObjectStore("savedPosts", { keyPath: "statusId" });
      const memberships = db.createObjectStore("folderMemberships", {
        keyPath: ["folderId", "statusId"],
      });
      memberships.createIndex("by-folder", "folderId");
      memberships.createIndex("by-folder-added", ["folderId", "addedAt", "statusId"]);
      memberships.createIndex("by-status", "statusId");
      const evidence = db.createObjectStore("bookmarkEvidence", {
        keyPath: ["statusId", "xAccountId"],
      });
      evidence.createIndex("by-status", "statusId");
      folders.put({
        folderId: "fld_existing",
        name: "Existing",
        sortIndex: 0,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      });
    });
    request.addEventListener("success", () => {
      request.result.close();
      resolve();
    });
    request.addEventListener("error", () => reject(request.error));
  });
}

const EXPECTED_STORES = [
  "bookmarkEvidence",
  "folderMemberships",
  "folders",
  "replicaEntityState",
  "replicaOutbox",
  "replicaStatus",
  "savedPosts",
];

const EXPECTED: Record<string, { keyPath: string | string[]; indexes: Record<string, unknown> }> = {
  folders: {
    keyPath: "folderId",
    indexes: { "by-sort": "sortIndex", "by-deleted": "deletedAt" },
  },
  savedPosts: { keyPath: "statusId", indexes: {} },
  folderMemberships: {
    keyPath: ["folderId", "statusId"],
    indexes: {
      "by-folder": "folderId",
      "by-folder-added": ["folderId", "addedAt", "statusId"],
      "by-status": "statusId",
    },
  },
  bookmarkEvidence: {
    keyPath: ["statusId", "xAccountId"],
    indexes: { "by-status": "statusId" },
  },
  replicaEntityState: {
    keyPath: ["configurationId", "key"],
    indexes: {},
  },
  replicaOutbox: {
    keyPath: ["configurationId", "key"],
    indexes: {},
  },
  replicaStatus: {
    keyPath: "configurationId",
    indexes: {},
  },
};

const namesAnAccount = (keyPath: string | string[] | null): boolean =>
  [keyPath ?? []].flat().some((part) => /account|owner|twid|user/i.test(part));

describe("the local database's declared schema", () => {
  it("has exactly the declared public and replica stores, key paths and indexes", async () => {
    const db = await openCreatedDatabase();
    expect([...db.objectStoreNames].toSorted()).toEqual(EXPECTED_STORES);

    const tx = db.transaction(EXPECTED_STORES, "readonly");
    for (const name of EXPECTED_STORES) {
      const store = tx.objectStore(name);
      const expected = EXPECTED[name] as (typeof EXPECTED)[string];
      expect(store.keyPath, `${name}.keyPath`).toEqual(expected.keyPath);

      expect([...store.indexNames].toSorted(), `${name}.indexNames`).toEqual(
        Object.keys(expected.indexes).toSorted(),
      );
      for (const [indexName, keyPath] of Object.entries(expected.indexes)) {
        expect(store.index(indexName).keyPath, `${name}.${indexName}.keyPath`).toEqual(keyPath);
      }
    }
    db.close();
  });

  it("adds replica metadata without erasing a version-one Folder", async () => {
    const indexedDB = new IDBFactory();
    await seedVersionOneDatabase(indexedDB);

    const store = await createCollectionStore({ indexedDB, keyRange: IDBKeyRange });

    await expect(store.listFolders({ includeDeleted: false })).resolves.toEqual([
      {
        folderId: "fld_existing",
        name: "Existing",
        sortIndex: 0,
        createdAt: 1,
        updatedAt: 1,
        deletedAt: null,
      },
    ]);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(FOLDERS_DB_NAME, FOLDERS_DB_VERSION);
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    expect([...db.objectStoreNames].toSorted()).toEqual(EXPECTED_STORES);
    db.close();
  });

  it("keys an account in bookmarkEvidence and nowhere else", async () => {
    const db = await openCreatedDatabase();
    const tx = db.transaction(EXPECTED_STORES, "readonly");
    for (const name of EXPECTED_STORES) {
      const store = tx.objectStore(name);
      const keyPaths = [store.keyPath, ...[...store.indexNames].map((i) => store.index(i).keyPath)];
      expect(keyPaths.some(namesAnAccount), `${name} keys`).toBe(name === "bookmarkEvidence");
    }
    db.close();
  });
});
