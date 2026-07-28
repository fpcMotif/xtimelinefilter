import { beforeAll, describe, expect, it } from "vitest";

import type { CollectionStore } from "../types";
import { capture, freshStore } from "./fixtures";

/**
 * Success must not degrade the feature. Counts and Folder reads are index-backed
 * on this contract precisely so a Folder holding thousands of posts stays
 * usable, and this fixture is what makes that claim falsifiable.
 *
 * The split below is deliberate. Seeding 3000 posts is fixture cost, not the
 * claim — it is ~3.5s under coverage instrumentation, which would eat the
 * default timeout and turn a slow machine into a red bar that says nothing about
 * the store. So the seed gets its own budget, and every ASSERTION runs on the
 * suite's DEFAULT timeout with no extension. That is what makes the reads
 * falsifiable: a regression from an index-backed count to a whole-store scan, or
 * from a cursored page to a full read, blows the default timeout on its own.
 */

const TOTAL = 3000;
const FOLDERS = 6;
const PER_FOLDER = TOTAL / FOLDERS;
const SEED_BATCH = 100;

/** Zero-padded so id order is also insertion order. */
const idAt = (i: number): string => String(i).padStart(5, "0");

describe(`a folder holding ${PER_FOLDER} posts`, () => {
  let store: CollectionStore;
  let folderIds: string[];

  beforeAll(async () => {
    store = await freshStore();
    folderIds = [];
    for (let f = 0; f < FOLDERS; f++) {
      folderIds.push((await store.createFolder({ name: `F${f}` })).folderId);
    }
    // Batched rather than one-at-a-time: each save is its own transaction and
    // IndexedDB serializes overlapping readwrite transactions in creation order,
    // so the result is identical to a sequential seed and lands far sooner.
    for (let start = 0; start < TOTAL; start += SEED_BATCH) {
      await Promise.all(
        Array.from({ length: SEED_BATCH }, (_, n) => start + n).map((i) =>
          store.savePost({ folderId: folderIds[i % FOLDERS] as string, capture: capture(idAt(i)) }),
        ),
      );
    }
  }, 60_000);

  it("counts a folder and the distinct total without scanning", async () => {
    for (const folderId of folderIds) {
      expect(await store.countFolder({ folderId })).toBe(PER_FOLDER);
    }
    expect(await store.countSavedPosts()).toBe(TOTAL);
  });

  it("reads a first page, a cursored later page and a page past the end", async () => {
    const folderId = folderIds[0] as string;
    // Folder 0 holds every post whose index is a multiple of FOLDERS.
    const expectedAt = (n: number): string => idAt(n * FOLDERS);

    const first = await store.readFolderPage({ folderId, limit: 25 });
    expect(first.posts.map((p) => p.statusId)).toEqual(
      Array.from({ length: 25 }, (_, n) => expectedAt(n)),
    );
    expect(first.nextCursor).not.toBeNull();

    const second = await store.readFolderPage({ folderId, limit: 25, cursor: first.nextCursor });
    expect(second.posts.map((p) => p.statusId)).toEqual(
      Array.from({ length: 25 }, (_, n) => expectedAt(25 + n)),
    );

    // A page exactly the size of the folder is full, so it still hands back a
    // cursor — and reading past it is empty rather than wrapping to the top.
    const whole = await store.readFolderPage({ folderId, limit: PER_FOLDER });
    expect(whole.posts).toHaveLength(PER_FOLDER);
    expect(whole.nextCursor).not.toBeNull();
    const past = await store.readFolderPage({ folderId, limit: 25, cursor: whole.nextCursor });
    expect(past).toEqual({ posts: [], nextCursor: null });
  });
});
