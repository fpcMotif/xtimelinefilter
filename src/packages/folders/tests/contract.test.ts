import { beforeEach, describe, expect, it } from "vitest";

import { FOLDER_ID_RE } from "../ids";
import type { CollectionStore, Folder, SavedPost } from "../types";
import { capture, freshStore, inertStore } from "./fixtures";

/**
 * The seam's universal contract: invariants every CollectionStore implementation
 * must honour, driven through the {@link CollectionStore} interface — never the
 * concrete classes, which only the factory names. The local store's own
 * behaviour (persistence, paging, cascades) lives in `local-store.test.ts`; this
 * file pins what is true of ANY implementation, including the inert one.
 */

function isFolder(x: unknown): x is Folder {
  const f = x as Folder;
  return (
    typeof f?.folderId === "string" &&
    FOLDER_ID_RE.test(f.folderId) &&
    typeof f?.name === "string" &&
    typeof f?.sortIndex === "number" &&
    typeof f?.createdAt === "number" &&
    typeof f?.updatedAt === "number" &&
    (f.deletedAt === null || typeof f.deletedAt === "number")
  );
}

function isSavedPost(x: unknown): x is SavedPost {
  const p = x as SavedPost;
  return (
    typeof p?.statusId === "string" &&
    (p.permalink === null || typeof p.permalink === "string") &&
    Array.isArray(p?.media) &&
    typeof p?.capturedAt === "number" &&
    typeof p?.note === "string" &&
    Array.isArray(p?.tags)
  );
}

const implementations: Array<{ label: string; make: () => Promise<CollectionStore> }> = [
  { label: "local", make: freshStore },
  { label: "null", make: inertStore },
];

describe.each(implementations)("CollectionStore contract: $label", ({ make }) => {
  let store: CollectionStore;
  beforeEach(async () => {
    store = await make();
  });

  it("createFolder answers with a well-formed, package-minted Folder", async () => {
    const folder = await store.createFolder({ name: "Research" });
    expect(isFolder(folder)).toBe(true);
    expect(folder.name).toBe("Research");
    expect(folder.deletedAt).toBeNull();
  });

  it("every folder listed is well-formed and none is soft-deleted", async () => {
    await store.createFolder({ name: "Research" });
    const folders = await store.listFolders({});
    expect(folders.every(isFolder)).toBe(true);
    expect(folders.every((f) => f.deletedAt === null)).toBe(true);
  });

  it("folder writes resolve", async () => {
    const { folderId } = await store.createFolder({ name: "Research" });
    await expect(store.renameFolder({ folderId, name: "Design" })).resolves.toBeUndefined();
    await expect(store.reorderFolders({ folderIds: [folderId] })).resolves.toBeUndefined();
    await expect(
      store.deleteFolder({ folderId, disposition: "keep-posts" }),
    ).resolves.toBeUndefined();
  });

  it("a capture with no status id is unsavable and stores nothing", async () => {
    const { folderId } = await store.createFolder({ name: "Research" });
    expect(await store.savePost({ folderId, capture: capture(null) })).toEqual({
      status: "unsavable",
    });
    expect(await store.countSavedPosts()).toBe(0);
    expect(await store.countFolder({ folderId })).toBe(0);
  });

  it("post writes resolve and reads are well-formed or empty", async () => {
    const { folderId } = await store.createFolder({ name: "Research" });
    await store.savePost({ folderId, capture: capture("1") });
    const post = await store.getSavedPost({ statusId: "1" });
    expect(post === null || isSavedPost(post)).toBe(true);

    await expect(store.setNote({ statusId: "1", note: "why" })).resolves.toBeUndefined();
    await expect(store.setTags({ statusId: "1", tags: ["a"] })).resolves.toBeUndefined();
    const holding = await store.foldersHolding({ statusId: "1" });
    expect(Array.isArray(holding)).toBe(true);
    expect(holding.every((id) => typeof id === "string")).toBe(true);
    await expect(store.removeFromFolder({ folderId, statusId: "1" })).resolves.toBeUndefined();
    await expect(store.deleteSavedPost({ statusId: "1" })).resolves.toBeUndefined();
  });

  it("evidence writes resolve and reads are well-formed", async () => {
    await expect(
      store.recordBookmarkEvidence({
        statusId: "1",
        xAccountId: "acct-1",
        outcome: "confirmed",
        observedAt: 10,
      }),
    ).resolves.toBeUndefined();
    const rows = await store.listBookmarkEvidence({ statusId: "1" });
    expect(
      rows.every(
        (r) =>
          typeof r.statusId === "string" &&
          typeof r.xAccountId === "string" &&
          ["confirmed", "failed", "skipped"].includes(r.outcome) &&
          typeof r.observedAt === "number",
      ),
    ).toBe(true);
  });

  it("releases whatever it holds open, and says nothing about it", () => {
    expect(store.close()).toBeUndefined();
  });

  it("counts are numbers and a page is bounded and well-formed", async () => {
    const { folderId } = await store.createFolder({ name: "Research" });
    expect(typeof (await store.countFolder({ folderId }))).toBe("number");
    expect(typeof (await store.countSavedPosts())).toBe("number");

    const page = await store.readFolderPage({ folderId, limit: 2 });
    expect(page.posts.length).toBeLessThanOrEqual(2);
    expect(page.posts.every(isSavedPost)).toBe(true);
    expect(page.nextCursor === null || typeof page.nextCursor === "string").toBe(true);
  });
});

describe("the null implementation is inert", () => {
  it("accepts every write, returns nothing and counts zero", async () => {
    const store = await inertStore();
    const folder = await store.createFolder({ name: "Research" });
    await store.savePost({ folderId: folder.folderId, capture: capture("1") });
    await store.recordBookmarkEvidence({
      statusId: "1",
      xAccountId: "acct-1",
      outcome: "confirmed",
      observedAt: 10,
    });

    expect(await store.listFolders({})).toEqual([]);
    expect(await store.getSavedPost({ statusId: "1" })).toBeNull();
    expect(await store.listBookmarkEvidence({ statusId: "1" })).toEqual([]);
    expect(await store.foldersHolding({ statusId: "1" })).toEqual([]);
    expect(await store.countFolder({ folderId: folder.folderId })).toBe(0);
    expect(await store.countSavedPosts()).toBe(0);
    expect(await store.readFolderPage({ folderId: folder.folderId, limit: 10 })).toEqual({
      posts: [],
      nextCursor: null,
    });
  });
});

// Teeth: the checks above must reject an adapter that only looks compliant.
describe("the contract has teeth", () => {
  const brokenFolderShape = {
    async createFolder() {
      return { folderId: "caller-supplied", name: "Research" } as unknown as Folder;
    },
  } as unknown as CollectionStore;

  const rejectingWrite: Pick<CollectionStore, "renameFolder"> = {
    async renameFolder() {
      throw new Error("store down");
    },
  };

  const unboundedPage = {
    async readFolderPage() {
      return {
        posts: [{ statusId: "1" }, { statusId: "2" }, { statusId: "3" }] as SavedPost[],
        nextCursor: null,
      };
    },
  } as unknown as CollectionStore;

  it("a caller-supplied folder id fails the well-formed-Folder check", async () => {
    expect(isFolder(await brokenFolderShape.createFolder({ name: "Research" }))).toBe(false);
  });

  it("a throwing write fails the resolves check", async () => {
    await expect(rejectingWrite.renameFolder({ folderId: "f", name: "n" })).rejects.toThrow(
      "store down",
    );
  });

  it("an over-limit page fails the bounded-page check", async () => {
    const page = await unboundedPage.readFolderPage({ folderId: "f", limit: 2 });
    expect(page.posts.length <= 2).toBe(false);
    expect(page.posts.every(isSavedPost)).toBe(false);
  });
});
