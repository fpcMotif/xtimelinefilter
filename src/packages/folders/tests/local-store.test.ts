import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { FOLDER_ID_RE } from "../ids";
import { createCollectionStore } from "../index";
import type { CollectionStore } from "../types";
import { capture, freshStore } from "./fixtures";

describe("folders", () => {
  let store: CollectionStore;
  beforeEach(async () => {
    store = await freshStore();
  });

  it("mints ids in the declared format, which no caller can supply", async () => {
    const folder = await store.createFolder({ name: "Research" });
    expect(folder.folderId).toMatch(FOLDER_ID_RE);
  });

  it("lists folders in sort order, newest last", async () => {
    await store.createFolder({ name: "A" });
    await store.createFolder({ name: "B" });
    await store.createFolder({ name: "C" });
    expect((await store.listFolders({})).map((f) => f.name)).toEqual(["A", "B", "C"]);
    expect((await store.listFolders({})).map((f) => f.sortIndex)).toEqual([0, 1, 2]);
  });

  it("renames a folder", async () => {
    const { folderId } = await store.createFolder({ name: "Research" });
    await store.renameFolder({ folderId, name: "Design refs" });
    expect((await store.listFolders({}))[0]?.name).toBe("Design refs");
  });

  it("renaming an unknown folder is a harmless no-op", async () => {
    await store.createFolder({ name: "Research" });
    await store.renameFolder({ folderId: "fld_nope", name: "X" });
    expect((await store.listFolders({})).map((f) => f.name)).toEqual(["Research"]);
  });

  it("reorders folders, keeping unnamed ones behind in their existing order", async () => {
    const a = await store.createFolder({ name: "A" });
    await store.createFolder({ name: "B" });
    const c = await store.createFolder({ name: "C" });
    await store.reorderFolders({ folderIds: [c.folderId, a.folderId] });
    expect((await store.listFolders({})).map((f) => f.name)).toEqual(["C", "A", "B"]);
  });

  it("ignores an unknown id in a reorder", async () => {
    const a = await store.createFolder({ name: "A" });
    await store.createFolder({ name: "B" });
    await store.reorderFolders({ folderIds: ["fld_nope", a.folderId] });
    expect((await store.listFolders({})).map((f) => f.name)).toEqual(["A", "B"]);
  });

  it("soft-deletes: the folder leaves the listing but its record survives", async () => {
    const { folderId } = await store.createFolder({ name: "Research" });
    await store.deleteFolder({ folderId, disposition: "keep-posts" });
    expect(await store.listFolders({})).toEqual([]);
    const kept = await store.listFolders({ includeDeleted: true });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.deletedAt).toEqual(expect.any(Number));
  });

  it("never reuses a deleted folder's id", async () => {
    const first = await store.createFolder({ name: "Research" });
    await store.deleteFolder({ folderId: first.folderId, disposition: "keep-posts" });
    const second = await store.createFolder({ name: "Research" });
    expect(second.folderId).not.toBe(first.folderId);
    expect((await store.listFolders({ includeDeleted: true })).map((f) => f.folderId)).toContain(
      first.folderId,
    );
  });

  it("deleting an unknown folder is a harmless no-op", async () => {
    await store.createFolder({ name: "Research" });
    await store.deleteFolder({ folderId: "fld_nope", disposition: "keep-posts" });
    expect(await store.listFolders({})).toHaveLength(1);
  });
});

describe("a post is saved once", () => {
  let store: CollectionStore;
  beforeEach(async () => {
    store = await freshStore();
  });

  it("filing into a second folder adds a row, not a second post", async () => {
    const a = await store.createFolder({ name: "A" });
    const b = await store.createFolder({ name: "B" });
    expect(await store.savePost({ folderId: a.folderId, capture: capture("1") })).toEqual({
      status: "saved",
      statusId: "1",
    });
    const before = await store.getSavedPost({ statusId: "1" });
    await store.setNote({ statusId: "1", note: "why I kept it" });
    await store.setTags({ statusId: "1", tags: ["ml"] });

    expect(await store.savePost({ folderId: b.folderId, capture: capture("1") })).toEqual({
      status: "saved",
      statusId: "1",
    });

    expect(await store.countSavedPosts()).toBe(1);
    expect(await store.countFolder({ folderId: a.folderId })).toBe(1);
    expect(await store.countFolder({ folderId: b.folderId })).toBe(1);
    const after = await store.getSavedPost({ statusId: "1" });
    expect(after?.capturedAt).toBe(before?.capturedAt);
    expect(after?.note).toBe("why I kept it");
    expect(after?.tags).toEqual(["ml"]);
  });

  it("re-filing into a folder that already holds it is 'already there' and mutates nothing", async () => {
    const { folderId } = await store.createFolder({ name: "A" });
    await store.savePost({ folderId, capture: capture("1") });
    await store.setNote({ statusId: "1", note: "keep me" });
    await store.setTags({ statusId: "1", tags: ["ml"] });
    const before = await store.getSavedPost({ statusId: "1" });

    expect(await store.savePost({ folderId, capture: capture("1", { text: "edited" }) })).toEqual({
      status: "already-there",
      statusId: "1",
    });

    expect(await store.getSavedPost({ statusId: "1" })).toEqual(before);
    expect(await store.countFolder({ folderId })).toBe(1);
    expect(await store.countSavedPosts()).toBe(1);
  });

  it("counts three folders holding one post as 1/1/1 with a distinct total of 1", async () => {
    const folders = [];
    for (const name of ["A", "B", "C"]) folders.push(await store.createFolder({ name }));
    for (const f of folders) await store.savePost({ folderId: f.folderId, capture: capture("1") });
    for (const f of folders) expect(await store.countFolder({ folderId: f.folderId })).toBe(1);
    expect(await store.countSavedPosts()).toBe(1);
  });

  it("stores a partial capture without throwing", async () => {
    const { folderId } = await store.createFolder({ name: "A" });
    await store.savePost({
      folderId,
      capture: { statusId: "1", permalink: null, media: [] },
    });
    const post = await store.getSavedPost({ statusId: "1" });
    expect(post).toMatchObject({ statusId: "1", permalink: null, media: [], note: "", tags: [] });
    expect(post).not.toHaveProperty("author");
    expect(post).not.toHaveProperty("text");
    expect(post).not.toHaveProperty("postedAt");
  });

  it("never stores a capture with no status id", async () => {
    const { folderId } = await store.createFolder({ name: "A" });
    expect(
      await store.savePost({
        folderId,
        capture: { statusId: null, permalink: null, media: [] },
      }),
    ).toEqual({ status: "unsavable" });
    expect(await store.countSavedPosts()).toBe(0);
  });
});

describe("unfiling is never deleting", () => {
  let store: CollectionStore;
  beforeEach(async () => {
    store = await freshStore();
  });

  it("removing from one folder leaves the post and its other rows", async () => {
    const a = await store.createFolder({ name: "A" });
    const b = await store.createFolder({ name: "B" });
    await store.savePost({ folderId: a.folderId, capture: capture("1") });
    await store.savePost({ folderId: b.folderId, capture: capture("1") });

    await store.removeFromFolder({ folderId: a.folderId, statusId: "1" });

    expect(await store.countFolder({ folderId: a.folderId })).toBe(0);
    expect(await store.countFolder({ folderId: b.folderId })).toBe(1);
    expect(await store.getSavedPost({ statusId: "1" })).not.toBeNull();
  });

  it("reports which folders hold a post, and none once it is unfiled", async () => {
    const a = await store.createFolder({ name: "A" });
    const b = await store.createFolder({ name: "B" });
    await store.savePost({ folderId: a.folderId, capture: capture("1") });
    await store.savePost({ folderId: b.folderId, capture: capture("1") });
    await store.savePost({ folderId: a.folderId, capture: capture("2") });

    expect((await store.foldersHolding({ statusId: "1" })).toSorted()).toEqual(
      [a.folderId, b.folderId].toSorted(),
    );
    expect(await store.foldersHolding({ statusId: "2" })).toEqual([a.folderId]);
    expect(await store.foldersHolding({ statusId: "nope" })).toEqual([]);

    await store.removeFromFolder({ folderId: a.folderId, statusId: "1" });
    expect(await store.foldersHolding({ statusId: "1" })).toEqual([b.folderId]);
  });

  it("stops reporting a deleted folder as holding a post", async () => {
    const a = await store.createFolder({ name: "A" });
    await store.savePost({ folderId: a.folderId, capture: capture("1") });
    await store.deleteFolder({ folderId: a.folderId, disposition: "keep-posts" });
    expect(await store.foldersHolding({ statusId: "1" })).toEqual([]);
  });

  it("deleting the post outright takes its rows and evidence with it", async () => {
    const a = await store.createFolder({ name: "A" });
    const b = await store.createFolder({ name: "B" });
    await store.savePost({ folderId: a.folderId, capture: capture("1") });
    await store.savePost({ folderId: b.folderId, capture: capture("1") });
    await store.recordBookmarkEvidence({
      statusId: "1",
      xAccountId: "acct-1",
      outcome: "confirmed",
      observedAt: 1,
    });

    await store.deleteSavedPost({ statusId: "1" });

    expect(await store.getSavedPost({ statusId: "1" })).toBeNull();
    expect(await store.countFolder({ folderId: a.folderId })).toBe(0);
    expect(await store.countFolder({ folderId: b.folderId })).toBe(0);
    expect(await store.listBookmarkEvidence({ statusId: "1" })).toEqual([]);
    expect(await store.countSavedPosts()).toBe(0);
  });

  it("deleting a folder with keep-posts leaves every post standing", async () => {
    const a = await store.createFolder({ name: "A" });
    await store.savePost({ folderId: a.folderId, capture: capture("1") });

    await store.deleteFolder({ folderId: a.folderId, disposition: "keep-posts" });

    expect(await store.getSavedPost({ statusId: "1" })).not.toBeNull();
    expect(await store.countSavedPosts()).toBe(1);
    expect(await store.countFolder({ folderId: a.folderId })).toBe(0);
  });

  it("delete-orphaned-posts never deletes a post another folder still holds", async () => {
    const a = await store.createFolder({ name: "A" });
    const b = await store.createFolder({ name: "B" });
    // "1" is in both folders; "2" is only in A.
    await store.savePost({ folderId: a.folderId, capture: capture("1") });
    await store.savePost({ folderId: b.folderId, capture: capture("1") });
    await store.savePost({ folderId: a.folderId, capture: capture("2") });
    await store.recordBookmarkEvidence({
      statusId: "2",
      xAccountId: "acct-1",
      outcome: "confirmed",
      observedAt: 1,
    });

    await store.deleteFolder({ folderId: a.folderId, disposition: "delete-orphaned-posts" });

    expect(await store.getSavedPost({ statusId: "1" })).not.toBeNull();
    expect(await store.getSavedPost({ statusId: "2" })).toBeNull();
    expect(await store.listBookmarkEvidence({ statusId: "2" })).toEqual([]);
    expect(await store.countFolder({ folderId: b.folderId })).toBe(1);
    expect(await store.countSavedPosts()).toBe(1);
  });

  it("countFolderShared counts only posts another live Folder also holds", async () => {
    const a = await store.createFolder({ name: "A" });
    const b = await store.createFolder({ name: "B" });
    // "1" is in both; "2" and "3" are only in A.
    await store.savePost({ folderId: a.folderId, capture: capture("1") });
    await store.savePost({ folderId: b.folderId, capture: capture("1") });
    await store.savePost({ folderId: a.folderId, capture: capture("2") });
    await store.savePost({ folderId: a.folderId, capture: capture("3") });

    expect(await store.countFolderShared({ folderId: a.folderId })).toBe(1);
    expect(await store.countFolderShared({ folderId: b.folderId })).toBe(1);

    // Deleting the OTHER folder holding "1" — with either disposition — drops
    // the shared count to zero: nothing else holds it any more.
    await store.deleteFolder({ folderId: b.folderId, disposition: "keep-posts" });
    expect(await store.countFolderShared({ folderId: a.folderId })).toBe(0);
  });

  it("countFolderShared is zero for a Folder holding nothing", async () => {
    const a = await store.createFolder({ name: "A" });
    expect(await store.countFolderShared({ folderId: a.folderId })).toBe(0);
  });
});

describe("bookmark evidence appends", () => {
  let store: CollectionStore;
  beforeEach(async () => {
    store = await freshStore();
  });

  it("a second account adds a row beside the first", async () => {
    await store.recordBookmarkEvidence({
      statusId: "1",
      xAccountId: "acct-1",
      outcome: "confirmed",
      observedAt: 1,
    });
    await store.recordBookmarkEvidence({
      statusId: "1",
      xAccountId: "acct-2",
      outcome: "failed",
      observedAt: 2,
    });
    const rows = await store.listBookmarkEvidence({ statusId: "1" });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.xAccountId).toSorted()).toEqual(["acct-1", "acct-2"]);
  });

  it("recording again for the same account replaces that account's row, never appends", async () => {
    await store.recordBookmarkEvidence({
      statusId: "1",
      xAccountId: "acct-1",
      outcome: "failed",
      observedAt: 1,
    });
    await store.recordBookmarkEvidence({
      statusId: "1",
      xAccountId: "acct-1",
      outcome: "confirmed",
      observedAt: 9,
    });
    // A later observation for the same account is a fresher reading of the same
    // fact, so it wins outright — one row per account, always.
    expect(await store.listBookmarkEvidence({ statusId: "1" })).toEqual([
      { statusId: "1", xAccountId: "acct-1", outcome: "confirmed", observedAt: 9 },
    ]);
  });

  it("re-recording the same outcome refreshes that account's observed-at in place", async () => {
    for (const observedAt of [1, 5]) {
      await store.recordBookmarkEvidence({
        statusId: "1",
        xAccountId: "acct-1",
        outcome: "confirmed",
        observedAt,
      });
    }
    expect(await store.listBookmarkEvidence({ statusId: "1" })).toEqual([
      { statusId: "1", xAccountId: "acct-1", outcome: "confirmed", observedAt: 5 },
    ]);
  });

  it("no rows means the leg never ran — not a fourth outcome", async () => {
    expect(await store.listBookmarkEvidence({ statusId: "never" })).toEqual([]);
  });

  it("an evidence write creates no Saved Post and no Folder row", async () => {
    const { folderId } = await store.createFolder({ name: "A" });
    await store.recordBookmarkEvidence({
      statusId: "1",
      xAccountId: "acct-1",
      outcome: "skipped",
      observedAt: 1,
    });
    expect(await store.getSavedPost({ statusId: "1" })).toBeNull();
    expect(await store.countSavedPosts()).toBe(0);
    expect(await store.countFolder({ folderId })).toBe(0);
  });
});

describe("note and tags", () => {
  let store: CollectionStore;
  beforeEach(async () => {
    store = await freshStore();
  });

  it("writing them leaves captured-at, folder rows and evidence untouched", async () => {
    const { folderId } = await store.createFolder({ name: "A" });
    await store.savePost({ folderId, capture: capture("1") });
    await store.recordBookmarkEvidence({
      statusId: "1",
      xAccountId: "acct-1",
      outcome: "confirmed",
      observedAt: 1,
    });
    const before = await store.getSavedPost({ statusId: "1" });

    await store.setNote({ statusId: "1", note: "why" });
    await store.setTags({ statusId: "1", tags: ["ml", "papers"] });

    const after = await store.getSavedPost({ statusId: "1" });
    expect(after?.capturedAt).toBe(before?.capturedAt);
    expect(after?.note).toBe("why");
    expect(after?.tags).toEqual(["ml", "papers"]);
    expect(await store.countFolder({ folderId })).toBe(1);
    expect(await store.listBookmarkEvidence({ statusId: "1" })).toHaveLength(1);
  });

  it("de-duplicates tags, drops blanks, truncates long ones and caps the count", async () => {
    const { folderId } = await store.createFolder({ name: "A" });
    await store.savePost({ folderId, capture: capture("1") });

    await store.setTags({ statusId: "1", tags: ["ml", " ml ", "   ", "x".repeat(80)] });
    const tags = (await store.getSavedPost({ statusId: "1" }))?.tags ?? [];
    expect(tags).toEqual(["ml", "x".repeat(48)]);

    await store.setTags({
      statusId: "1",
      tags: Array.from({ length: 40 }, (_, i) => `t${i}`),
    });
    expect((await store.getSavedPost({ statusId: "1" }))?.tags).toHaveLength(32);
  });

  it("annotating an unknown post is a harmless no-op", async () => {
    await store.setNote({ statusId: "nope", note: "x" });
    await store.setTags({ statusId: "nope", tags: ["x"] });
    expect(await store.getSavedPost({ statusId: "nope" })).toBeNull();
  });
});

describe("bounded, ordered pages", () => {
  let store: CollectionStore;
  let folderId: string;
  beforeEach(async () => {
    store = await freshStore();
    folderId = (await store.createFolder({ name: "A" })).folderId;
    for (const id of ["01", "02", "03", "04", "05"]) {
      await store.savePost({ folderId, capture: capture(id) });
    }
  });

  it("reads a first page and a cursored later page, then stops", async () => {
    const first = await store.readFolderPage({ folderId, limit: 2 });
    expect(first.posts.map((p) => p.statusId)).toEqual(["01", "02"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await store.readFolderPage({ folderId, limit: 2, cursor: first.nextCursor });
    expect(second.posts.map((p) => p.statusId)).toEqual(["03", "04"]);

    const third = await store.readFolderPage({ folderId, limit: 2, cursor: second.nextCursor });
    expect(third.posts.map((p) => p.statusId)).toEqual(["05"]);
    expect(third.nextCursor).toBeNull();
  });

  it("returns an empty page past the end", async () => {
    const all = await store.readFolderPage({ folderId, limit: 5 });
    const past = await store.readFolderPage({ folderId, limit: 5, cursor: all.nextCursor });
    expect(past).toEqual({ posts: [], nextCursor: null });
  });

  it("reads an empty folder as an empty page", async () => {
    const empty = (await store.createFolder({ name: "Empty" })).folderId;
    expect(await store.readFolderPage({ folderId: empty, limit: 5 })).toEqual({
      posts: [],
      nextCursor: null,
    });
  });

  it("treats a cursor it did not mint as the start of the folder", async () => {
    // The cursor is opaque and store-minted; a value that is not one reads from
    // the top rather than silently reporting an empty folder.
    for (const bogus of ["", "no-separator", "notanumber:01"]) {
      const page = await store.readFolderPage({ folderId, limit: 2, cursor: bogus });
      expect(page.posts.map((p) => p.statusId)).toEqual(["01", "02"]);
    }
  });

  it("pages one folder without seeing another's rows", async () => {
    const other = (await store.createFolder({ name: "B" })).folderId;
    await store.savePost({ folderId: other, capture: capture("99") });
    const page = await store.readFolderPage({ folderId: other, limit: 10 });
    expect(page.posts.map((p) => p.statusId)).toEqual(["99"]);
  });
});

describe("database lifecycle", () => {
  it("creates the schema on first open and reuses it on the next", async () => {
    const indexedDB = new IDBFactory();
    const first = await createCollectionStore({ indexedDB, keyRange: IDBKeyRange });
    const { folderId } = await first.createFolder({ name: "Research" });
    await first.savePost({ folderId, capture: capture("1") });

    // A second open at the same version must NOT re-run the upgrade, and must
    // read what a store created by the previous open wrote.
    const second = await createCollectionStore({ indexedDB, keyRange: IDBKeyRange });
    expect((await second.listFolders({})).map((f) => f.name)).toEqual(["Research"]);
    expect(await second.getSavedPost({ statusId: "1" })).not.toBeNull();
    expect(await second.countSavedPosts()).toBe(1);
  });

  it("degrades to the null object when no database is supplied", async () => {
    const store = await createCollectionStore({});
    expect(await store.listFolders({})).toEqual([]);
    expect(await createCollectionStore({ indexedDB: new IDBFactory() })).toBeDefined();
    expect(await (await createCollectionStore({ keyRange: IDBKeyRange })).countSavedPosts()).toBe(
      0,
    );
  });

  it("degrades to the null object when the database refuses to open", async () => {
    const store = await createCollectionStore({
      indexedDB: failingFactory(),
      keyRange: IDBKeyRange,
    });
    const folder = await store.createFolder({ name: "Research" });
    expect(await store.listFolders({})).toEqual([]);
    expect(await store.countFolder({ folderId: folder.folderId })).toBe(0);
  });

  it("rejects rather than hanging when a transaction aborts", async () => {
    const store = await createCollectionStore({
      indexedDB: abortingFactory(),
      keyRange: IDBKeyRange,
    });
    await expect(store.countSavedPosts()).rejects.toThrow("transaction aborted");
  });
});

/**
 * A minimal IDB object that fires exactly one event type, so a test can put the
 * store in a state the real database will not reproduce on demand. It listens
 * the way the store listens — `addEventListener`, not an `on*` assignment — so
 * the fake stays honest about the API it stands in for.
 */
function firesOnce(fires: string, props: Record<string, unknown>): Record<string, unknown> {
  const listeners: Array<() => void> = [];
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
  return {
    ...props,
    addEventListener(type: string, listener: () => void) {
      if (type === fires) listeners.push(listener);
    },
  };
}

const stubRequest = (): unknown => ({});

/** An IDBFactory whose open fails — a host whose database is unusable. */
function failingFactory(): IDBFactory {
  return {
    open: () =>
      firesOnce("error", { error: new Error("blocked"), result: null }) as unknown as IDBRequest,
  } as unknown as IDBFactory;
}

/**
 * An IDBFactory that opens fine but whose every transaction aborts. Drives the
 * one rejection path the store has, proving a failed write surfaces as a
 * rejected promise instead of a promise that never settles.
 */
function abortingFactory(): IDBFactory {
  const db = {
    transaction: () =>
      firesOnce("abort", {
        error: new Error("transaction aborted"),
        objectStore: () => ({
          get: stubRequest,
          put: stubRequest,
          delete: stubRequest,
          count: stubRequest,
          index: () => ({
            getAll: stubRequest,
            getAllKeys: stubRequest,
            count: stubRequest,
            openCursor: stubRequest,
          }),
        }),
      }),
  };
  return {
    open: () => firesOnce("success", { result: db }) as unknown as IDBRequest,
  } as unknown as IDBFactory;
}
