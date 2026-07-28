import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { createDataLifecycle } from "@/background/data-lifecycle";
import { SEEDED_FOLDER_NAME } from "@/background/data-lifecycle/collections";
import type { CacheObservation } from "@/core/cache-observation";
import type { CollectionsRequest, DefaultSaveOutcome } from "@/core/protocol/collections";
import { ALWAYS_ASK } from "@/core/settings-domain";
import { createCollectionStore } from "@/packages/folders";
import type { PostCapture } from "@/packages/folders/types";

import { createMemoryArea } from "../helpers/chrome-fake";

const TYPE = "lasso:collections";
const STATUS = "1234567890";

const capture = (statusId: string | null = STATUS): PostCapture => ({
  statusId,
  permalink: statusId ? `https://x.com/jack/status/${statusId}` : null,
  media: [],
});

/**
 * The compound save, driven through the worker. `currentOwner` is deliberately
 * absent from every seam here: nothing on this path may read the signed-in X
 * account, so there is nothing to inject.
 */
function worker() {
  const local = createMemoryArea();
  const indexedDB = new IDBFactory();
  const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "mirror-id", {
    open: () => createCollectionStore({ indexedDB, keyRange: IDBKeyRange }),
  });
  const run = (request: CollectionsRequest) => lifecycle.collections(request);
  const token = async () =>
    ((await run({ type: TYPE, operation: "begin" })) as { token: CacheObservation }).token;
  const save = async (post: PostCapture = capture()) =>
    (
      (await run({
        type: TYPE,
        operation: "save-to-default-folder",
        capture: post,
        token: await token(),
      })) as { defaultSave: DefaultSaveOutcome }
    ).defaultSave;
  return { lifecycle, run, token, save };
}

describe("the default Folder's three states", () => {
  let w: ReturnType<typeof worker>;
  beforeEach(() => {
    w = worker();
  });

  it("(a) files into the named Folder when one is set", async () => {
    const created = (await w.run({
      type: TYPE,
      operation: "create-folder",
      name: "Research",
      token: await w.token(),
    })) as { folder: { folderId: string } };
    await w.lifecycle.patchSettings({ defaultFolderId: created.folder.folderId });

    expect(await w.save()).toEqual({
      status: "saved",
      saved: "created",
      createdSavedPost: true,
      folderId: created.folder.folderId,
      folderName: "Research",
      statusId: STATUS,
    });
  });

  it("(b) files nothing when the user explicitly chose always-ask", async () => {
    await w.lifecycle.patchSettings({ defaultFolderId: ALWAYS_ASK });

    expect(await w.save()).toEqual({ status: "ask" });
    // Neither the seed path nor the adopt-first path may fire in this state.
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 0, savedPosts: 0 },
    });
    expect((await w.lifecycle.readSettings()).defaultFolderId).toBe(ALWAYS_ASK);
  });

  it("(c) seeds one Folder named Saved when never set and the store is empty", async () => {
    const outcome = await w.save();
    expect(outcome).toMatchObject({ status: "saved", folderName: SEEDED_FOLDER_NAME });

    const folders = (await w.run({
      type: TYPE,
      operation: "list-folders",
      includeDeleted: false,
    })) as { folders: { folderId: string; name: string }[] };
    expect(folders.folders.map((f) => f.name)).toEqual([SEEDED_FOLDER_NAME]);
    // The choice is adopted, so the next press does not resolve again.
    expect((await w.lifecycle.readSettings()).defaultFolderId).toBe(folders.folders[0]?.folderId);
  });

  it("(c) adopts the first Folder in sort order rather than seeding a second", async () => {
    for (const name of ["A", "B"]) {
      await w.run({ type: TYPE, operation: "create-folder", name, token: await w.token() });
    }
    expect(await w.save()).toMatchObject({ folderName: "A" });
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 2, savedPosts: 1 },
    });
  });

  it("(c) re-resolves when the named Folder has since been deleted", async () => {
    const created = (await w.run({
      type: TYPE,
      operation: "create-folder",
      name: "Gone",
      token: await w.token(),
    })) as { folder: { folderId: string } };
    await w.lifecycle.patchSettings({ defaultFolderId: created.folder.folderId });
    await w.run({
      type: TYPE,
      operation: "delete-folder",
      folderId: created.folder.folderId,
      disposition: "keep-posts",
      token: await w.token(),
    });

    // A dangling id resolves silently rather than failing the gesture.
    expect(await w.save()).toMatchObject({ status: "saved", folderName: SEEDED_FOLDER_NAME });
  });
});

describe("the compound save is one operation", () => {
  it("yields one Folder and one Folder row for two presses on a fresh install", async () => {
    const w = worker();
    // Dispatched back to back before the first resolves. The worker's serialized
    // queue is what makes seed-adopt-file atomic; a content script that read the
    // setting and then wrote could not do this.
    const [first, second] = await Promise.all([w.save(), w.save()]);

    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 1, savedPosts: 1 },
    });
    expect(first.status).toBe("saved");
    expect(second.status).toBe("saved");
    // One of them created the row; the other found it already there.
    const outcomes = [first, second].map((o) => (o.status === "saved" ? o.saved : o.status));
    expect(outcomes.toSorted()).toEqual(["already-there", "created"]);
  });

  it("reports already-there without writing, keeping captured-at, note and tags", async () => {
    const w = worker();
    const first = await w.save();
    if (first.status !== "saved") throw new Error("expected a save");
    await w.run({
      type: TYPE,
      operation: "set-note",
      statusId: STATUS,
      note: "why",
      token: await w.token(),
    });
    const before = await w.run({ type: TYPE, operation: "get-saved-post", statusId: STATUS });

    expect(await w.save()).toEqual({ ...first, saved: "already-there", createdSavedPost: false });
    expect(await w.run({ type: TYPE, operation: "get-saved-post", statusId: STATUS })).toEqual(
      before,
    );
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 1, savedPosts: 1 },
    });
  });

  it("says createdSavedPost is false when the post is already saved elsewhere", async () => {
    const w = worker();
    const other = (await w.run({
      type: TYPE,
      operation: "create-folder",
      name: "Other",
      token: await w.token(),
    })) as { folder: { folderId: string } };
    await w.run({
      type: TYPE,
      operation: "save-post",
      folderId: other.folder.folderId,
      capture: capture(),
      token: await w.token(),
    });
    const target = (await w.run({
      type: TYPE,
      operation: "create-folder",
      name: "Target",
      token: await w.token(),
    })) as { folder: { folderId: string } };
    await w.lifecycle.patchSettings({ defaultFolderId: target.folder.folderId });

    // A new Folder row, but the Saved Post already existed — so Undo must not
    // remove it.
    expect(await w.save()).toMatchObject({ saved: "created", createdSavedPost: false });
  });

  it("rejects a capture with no durable identity, writing nothing", async () => {
    const w = worker();
    expect(await w.save(capture(null))).toEqual({ status: "unsavable" });
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 0, savedPosts: 0 },
    });
  });

  it("stores a partial capture: missing text, author and posted-at still save", async () => {
    const w = worker();
    expect(await w.save({ statusId: STATUS, permalink: null, media: [] })).toMatchObject({
      status: "saved",
    });
  });
});

describe("the default Folder carries no X account", () => {
  it("persists a bare folder-id string, never an owner-qualified tuple", async () => {
    const w = worker();
    await w.save();
    const stored = (await w.lifecycle.readSettings()).defaultFolderId;
    // `defaultList` is an {ownerUserId, listId} tuple that no-ops on the wrong
    // account. This is deliberately not that.
    expect(typeof stored).toBe("string");
    expect(stored).toMatch(/^fld_[0-9a-v]{20}$/);
  });

  it("files the same post into the same Folder however the request is repeated", async () => {
    const w = worker();
    const first = await w.save();
    if (first.status !== "saved") throw new Error("expected a save");
    // There is no account seam to vary — the request carries none — so repeating
    // the gesture is the strongest form of this the layer can state.
    for (let i = 0; i < 3; i++) {
      expect(await w.save()).toMatchObject({
        folderId: first.folderId,
        saved: "already-there",
      });
    }
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 1, savedPosts: 1 },
    });
  });
});
