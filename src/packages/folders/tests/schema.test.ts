import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createCollectionStore, FOLDERS_DB_NAME, FOLDERS_DB_VERSION } from "../index";

/**
 * The database's declared shape, asserted against literal lists. Any extra
 * object store, key path or index — under any name — fails this, which is what
 * makes "no account is ever keyed" checkable rather than aspirational:
 * `bookmarkEvidence` is the sole place `xAccountId` may appear in a key.
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

const EXPECTED_STORES = ["bookmarkEvidence", "folderMemberships", "folders", "savedPosts"];

const EXPECTED: Record<string, { keyPath: string | string[]; indexes: Record<string, unknown> }> = {
  folders: { keyPath: "folderId", indexes: { "by-sort": "sortIndex" } },
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
};

const namesAnAccount = (keyPath: string | string[] | null): boolean =>
  [keyPath ?? []].flat().some((part) => /account|owner|twid|user/i.test(part));

describe("the local database's declared schema", () => {
  it("has exactly the four declared stores, key paths and indexes", async () => {
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
