import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import { createDataLifecycle } from "@/background/data-lifecycle";
import { defaultCollectionStore } from "@/background/data-lifecycle/collections";
import { canHandleMessage } from "@/background/message-policy";
import type { SenderCapability } from "@/background/message-sender";
import type { CacheObservation } from "@/core/cache-observation";
import {
  COLLECTIONS_OPERATIONS,
  MAX_LIVE_FOLDERS,
  type CollectionsOperation,
  type CollectionsRequest,
} from "@/core/protocol/collections";
import { createCollectionStore } from "@/packages/folders";
import type { CollectionStore, PostCapture } from "@/packages/folders/types";

import { createMemoryArea } from "../helpers/chrome-fake";

const TYPE = "lasso:collections";
const STATUS = "1234567890";

const capture = (statusId: string): PostCapture => ({
  statusId,
  permalink: `https://x.com/jack/status/${statusId}`,
  author: { screenName: "jack" },
  text: `post ${statusId}`,
  media: [],
});

const FOLDER = "fld_abcdefghijklmnopqrst";
const TOKEN: CacheObservation = { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 };

/** One valid request per operation, so a test can walk the whole family. */
const VALID_BY_OPERATION: Record<CollectionsOperation, CollectionsRequest> = {
  begin: { type: TYPE, operation: "begin" },
  "list-folders": { type: TYPE, operation: "list-folders", includeDeleted: false },
  "folders-holding": { type: TYPE, operation: "folders-holding", statusId: STATUS },
  "create-folder": { type: TYPE, operation: "create-folder", name: "Research", token: TOKEN },
  "rename-folder": {
    type: TYPE,
    operation: "rename-folder",
    folderId: FOLDER,
    name: "Design",
    token: TOKEN,
  },
  "reorder-folders": { type: TYPE, operation: "reorder-folders", folderIds: [], token: TOKEN },
  "delete-folder": {
    type: TYPE,
    operation: "delete-folder",
    folderId: FOLDER,
    disposition: "keep-posts",
    token: TOKEN,
  },
  "save-post": {
    type: TYPE,
    operation: "save-post",
    folderId: FOLDER,
    capture: capture(STATUS),
    token: TOKEN,
  },
  "remove-from-folder": {
    type: TYPE,
    operation: "remove-from-folder",
    folderId: FOLDER,
    statusId: STATUS,
    token: TOKEN,
  },
  "delete-saved-post": {
    type: TYPE,
    operation: "delete-saved-post",
    statusId: STATUS,
    token: TOKEN,
  },
  "get-saved-post": { type: TYPE, operation: "get-saved-post", statusId: STATUS },
  "set-note": { type: TYPE, operation: "set-note", statusId: STATUS, note: "why", token: TOKEN },
  "set-tags": { type: TYPE, operation: "set-tags", statusId: STATUS, tags: ["ml"], token: TOKEN },
  "record-bookmark-evidence": {
    type: TYPE,
    operation: "record-bookmark-evidence",
    statusId: STATUS,
    xAccountId: "acct-1",
    outcome: "confirmed",
    observedAt: 10,
    token: TOKEN,
  },
  "list-bookmark-evidence": { type: TYPE, operation: "list-bookmark-evidence", statusId: STATUS },
  "count-folder": { type: TYPE, operation: "count-folder", folderId: FOLDER },
  counts: { type: TYPE, operation: "counts" },
  "save-to-default-folder": {
    type: TYPE,
    operation: "save-to-default-folder",
    capture: capture(STATUS),
    token: TOKEN,
  },
  "read-folder-page": {
    type: TYPE,
    operation: "read-folder-page",
    folderId: FOLDER,
    limit: 25,
    cursor: null,
  },
};

/**
 * The worker under test, over an in-memory database. `openStore` is injected so
 * no test — and no other context — ever names the IndexedDB implementation.
 */
function worker(store?: CollectionStore) {
  const local = createMemoryArea();
  const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "mirror-id", {
    open: async () =>
      store ??
      (await createCollectionStore({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange })),
  });
  const run = (request: CollectionsRequest) => lifecycle.collections(request);
  const token = async (): Promise<CacheObservation> => {
    const result = await run({ type: TYPE, operation: "begin" });
    return (result as { token: CacheObservation }).token;
  };
  return { local, lifecycle, run, token };
}

describe("collections sender capabilities", () => {
  const SURFACES: SenderCapability[] = ["options", "popup", "x-content", "unknown"];
  const ALLOWED: Record<string, CollectionsOperation[]> = {
    options: [...COLLECTIONS_OPERATIONS],
    popup: ["counts"],
    "x-content": [
      "begin",
      "list-folders",
      "folders-holding",
      "create-folder",
      "save-post",
      "save-to-default-folder",
      "remove-from-folder",
    ],
    unknown: [],
  };

  it("allows exactly the enumerated operations per surface and denies every other", () => {
    // Walks EVERY operation against EVERY surface: a later ticket adding one
    // must extend this table on purpose rather than widening a surface by
    // omission.
    for (const capability of SURFACES) {
      for (const operation of COLLECTIONS_OPERATIONS) {
        const expected = (ALLOWED[capability] as CollectionsOperation[]).includes(operation);
        expect(
          canHandleMessage(capability, { type: TYPE, operation }),
          `${capability} → ${operation}`,
        ).toBe(expected);
      }
    }
  });

  it("gives the popup a count and nothing that writes or reads a post", () => {
    expect(canHandleMessage("popup", { type: TYPE, operation: "counts" })).toBe(true);
    expect(canHandleMessage("popup", { type: TYPE, operation: "list-folders" })).toBe(false);
    expect(canHandleMessage("popup", { type: TYPE, operation: "get-saved-post" })).toBe(false);
  });

  it("withholds the count reads from the page", () => {
    expect(canHandleMessage("x-content", { type: TYPE, operation: "counts" })).toBe(false);
    expect(canHandleMessage("x-content", { type: TYPE, operation: "count-folder" })).toBe(false);
  });

  it("denies a message with no operation before any shape guard runs", () => {
    expect(canHandleMessage("options", { type: TYPE })).toBe(false);
    expect(canHandleMessage("x-content", { type: TYPE, operation: 7 })).toBe(false);
  });
});

describe("worker collections authority", () => {
  let w: ReturnType<typeof worker>;
  beforeEach(() => {
    w = worker();
  });

  it("creates, lists, renames, reorders and soft-deletes a folder", async () => {
    const created = (await w.run({
      type: TYPE,
      operation: "create-folder",
      name: "Research",
      token: await w.token(),
    })) as { folder: { folderId: string } };

    await w.run({
      type: TYPE,
      operation: "rename-folder",
      folderId: created.folder.folderId,
      name: "Design",
      token: await w.token(),
    });
    expect(await w.run({ type: TYPE, operation: "list-folders", includeDeleted: false })).toEqual({
      folders: [expect.objectContaining({ name: "Design" })],
    });

    await w.run({
      type: TYPE,
      operation: "delete-folder",
      folderId: created.folder.folderId,
      disposition: "keep-posts",
      token: await w.token(),
    });
    expect(await w.run({ type: TYPE, operation: "list-folders", includeDeleted: false })).toEqual({
      folders: [],
    });
    expect(
      (
        (await w.run({ type: TYPE, operation: "list-folders", includeDeleted: true })) as {
          folders: unknown[];
        }
      ).folders,
    ).toHaveLength(1);
  });

  it("cannot produce a second Saved Post for one status id", async () => {
    const a = (await w.run({
      type: TYPE,
      operation: "create-folder",
      name: "A",
      token: await w.token(),
    })) as { folder: { folderId: string } };
    const b = (await w.run({
      type: TYPE,
      operation: "create-folder",
      name: "B",
      token: await w.token(),
    })) as { folder: { folderId: string } };

    const save = async (folderId: string) =>
      w.run({
        type: TYPE,
        operation: "save-post",
        folderId,
        capture: capture(STATUS),
        token: await w.token(),
      });

    expect(await save(a.folder.folderId)).toEqual({
      outcome: { status: "saved", statusId: STATUS },
    });
    expect(await save(b.folder.folderId)).toEqual({
      outcome: { status: "saved", statusId: STATUS },
    });
    // Re-filing where it already sits is "already there" and writes nothing.
    expect(await save(a.folder.folderId)).toEqual({
      outcome: { status: "already-there", statusId: STATUS },
    });

    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 2, savedPosts: 1 },
    });
    expect(
      (
        (await w.run({ type: TYPE, operation: "folders-holding", statusId: STATUS })) as {
          folderIds: string[];
        }
      ).folderIds.toSorted(),
    ).toEqual([a.folder.folderId, b.folder.folderId].toSorted());
  });

  it("answers unsavable for a capture with no durable identity, storing nothing", async () => {
    const folder = (await w.run({
      type: TYPE,
      operation: "create-folder",
      name: "A",
      token: await w.token(),
    })) as { folder: { folderId: string } };
    expect(
      await w.run({
        type: TYPE,
        operation: "save-post",
        folderId: folder.folder.folderId,
        capture: { statusId: null, permalink: null, media: [] },
        token: await w.token(),
      }),
    ).toEqual({ outcome: { status: "unsavable" } });
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 1, savedPosts: 0 },
    });
  });

  it("carries a post's note, tags, evidence and page reads end to end", async () => {
    const folder = (
      (await w.run({
        type: TYPE,
        operation: "create-folder",
        name: "A",
        token: await w.token(),
      })) as { folder: { folderId: string } }
    ).folder;
    await w.run({
      type: TYPE,
      operation: "save-post",
      folderId: folder.folderId,
      capture: capture(STATUS),
      token: await w.token(),
    });
    await w.run({
      type: TYPE,
      operation: "set-note",
      statusId: STATUS,
      note: "why",
      token: await w.token(),
    });
    await w.run({
      type: TYPE,
      operation: "set-tags",
      statusId: STATUS,
      tags: ["ml"],
      token: await w.token(),
    });
    await w.run({
      type: TYPE,
      operation: "record-bookmark-evidence",
      statusId: STATUS,
      xAccountId: "acct-1",
      outcome: "confirmed",
      observedAt: 7,
      token: await w.token(),
    });

    expect(await w.run({ type: TYPE, operation: "get-saved-post", statusId: STATUS })).toEqual({
      post: expect.objectContaining({ note: "why", tags: ["ml"] }),
    });
    expect(
      await w.run({ type: TYPE, operation: "list-bookmark-evidence", statusId: STATUS }),
    ).toEqual({
      evidence: [{ statusId: STATUS, xAccountId: "acct-1", outcome: "confirmed", observedAt: 7 }],
    });
    expect(
      await w.run({ type: TYPE, operation: "count-folder", folderId: folder.folderId }),
    ).toEqual({ count: 1 });
    expect(
      await w.run({
        type: TYPE,
        operation: "read-folder-page",
        folderId: folder.folderId,
        limit: 10,
        cursor: null,
      }),
    ).toEqual({
      page: { posts: [expect.objectContaining({ statusId: STATUS })], nextCursor: null },
    });

    await w.run({
      type: TYPE,
      operation: "remove-from-folder",
      folderId: folder.folderId,
      statusId: STATUS,
      token: await w.token(),
    });
    expect(
      await w.run({ type: TYPE, operation: "count-folder", folderId: folder.folderId }),
    ).toEqual({ count: 0 });
    await w.run({
      type: TYPE,
      operation: "delete-saved-post",
      statusId: STATUS,
      token: await w.token(),
    });
    expect(await w.run({ type: TYPE, operation: "get-saved-post", statusId: STATUS })).toEqual({
      post: null,
    });

    const reordered = await w.run({
      type: TYPE,
      operation: "reorder-folders",
      folderIds: [folder.folderId],
      token: await w.token(),
    });
    expect(reordered).toEqual({});
  });

  it("refuses to create past the live-folder cap and says why", async () => {
    // Seed the store directly to the cap; the worker only counts live folders.
    const store = await createCollectionStore({
      indexedDB: new IDBFactory(),
      keyRange: IDBKeyRange,
    });
    for (let i = 0; i < MAX_LIVE_FOLDERS - 1; i++) await store.createFolder({ name: `F${i}` });
    const capped = worker(store);

    // The last one under the cap still succeeds …
    await expect(
      capped.run({
        type: TYPE,
        operation: "create-folder",
        name: "at the cap",
        token: await capped.token(),
      }),
    ).resolves.toMatchObject({ folder: expect.objectContaining({ name: "at the cap" }) });

    // … and the next is refused.
    await expect(
      capped.run({
        type: TYPE,
        operation: "create-folder",
        name: "one too many",
        token: await capped.token(),
      }),
    ).rejects.toThrow(`at most ${MAX_LIVE_FOLDERS} folders`);

    // A soft-deleted folder frees a slot, because the cap counts live ones.
    const folders = (
      (await capped.run({ type: TYPE, operation: "list-folders", includeDeleted: false })) as {
        folders: { folderId: string }[];
      }
    ).folders;
    await capped.run({
      type: TYPE,
      operation: "delete-folder",
      folderId: folders[0]!.folderId,
      disposition: "keep-posts",
      token: await capped.token(),
    });
    await expect(
      capped.run({
        type: TYPE,
        operation: "create-folder",
        name: "room again",
        token: await capped.token(),
      }),
    ).resolves.toMatchObject({ folder: expect.objectContaining({ name: "room again" }) });
  });

  it("refuses a write whose token belongs to a rotated epoch", async () => {
    // The Clear interaction is pinned in the privacy tests; this is the fence
    // itself — a token from an epoch the worker no longer recognises (here,
    // one never minted at all) must not be allowed to write.
    const stale: CacheObservation = {
      epoch: "00000000-0000-4000-8000-00000000dead",
      sequence: 1,
    };
    await expect(
      w.run({ type: TYPE, operation: "create-folder", name: "Research", token: stale }),
    ).rejects.toThrow("started before your data was cleared");
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 0, savedPosts: 0 },
    });
  });

  it("refuses a token from this epoch that runs ahead of the clock", async () => {
    const issued = await w.token();
    await expect(
      w.run({
        type: TYPE,
        operation: "create-folder",
        name: "Research",
        token: { epoch: issued.epoch, sequence: issued.sequence + 5 },
      }),
    ).rejects.toThrow("started before your data was cleared");
  });

  it("fails visibly when the database cannot be opened", async () => {
    const local = createMemoryArea();
    const broken = createDataLifecycle(local, createMemoryArea(), () => "mirror-id", {
      open: () => Promise.reject(new Error("quota")),
    });
    // No caller is ever told a save landed when it did not.
    await expect(broken.collections({ type: TYPE, operation: "counts" })).rejects.toThrow(
      "could not be opened",
    );
    const begun = (await broken.collections({ type: TYPE, operation: "begin" })) as {
      token: CacheObservation;
    };
    await expect(
      broken.collections({
        type: TYPE,
        operation: "create-folder",
        name: "Research",
        token: begun.token,
      }),
    ).rejects.toThrow("could not be opened");
  });

  it("answers a failure for EVERY operation when the database cannot be opened", async () => {
    const broken = createDataLifecycle(createMemoryArea(), createMemoryArea(), () => "mirror-id", {
      open: () => Promise.reject(new Error("quota")),
    });
    // `begin` only touches the observation clock, so it still answers — every
    // other operation must fail rather than pretend.
    await expect(broken.collections({ type: TYPE, operation: "begin" })).resolves.toMatchObject({
      token: expect.anything(),
    });

    for (const operation of COLLECTIONS_OPERATIONS) {
      if (operation === "begin") continue;
      const request = { ...VALID_BY_OPERATION[operation] } as CollectionsRequest;
      if ("token" in request) {
        (request as { token: CacheObservation }).token = (
          (await broken.collections({ type: TYPE, operation: "begin" })) as {
            token: CacheObservation;
          }
        ).token;
      }
      await expect(broken.collections(request), operation).rejects.toThrow("could not be opened");
    }
  });

  it("retries a failed open rather than caching the failure forever", async () => {
    let attempts = 0;
    const local = createMemoryArea();
    const flaky = createDataLifecycle(local, createMemoryArea(), () => "mirror-id", {
      open: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("worker was still waking up");
        return createCollectionStore({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange });
      },
    });
    await expect(flaky.collections({ type: TYPE, operation: "counts" })).rejects.toThrow(
      "could not be opened",
    );
    await expect(flaky.collections({ type: TYPE, operation: "counts" })).resolves.toEqual({
      counts: { folders: 0, savedPosts: 0 },
    });
  });

  it("opens the database once and reuses it across operations", async () => {
    let opens = 0;
    const local = createMemoryArea();
    const counted = createDataLifecycle(local, createMemoryArea(), () => "mirror-id", {
      open: async () => {
        opens += 1;
        return createCollectionStore({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange });
      },
    });
    await counted.collections({ type: TYPE, operation: "counts" });
    await counted.collections({ type: TYPE, operation: "list-folders", includeDeleted: false });
    expect(opens).toBe(1);
  });
});

describe("Folders survive the worker", () => {
  it("reads back what a previous facade wrote over the same store", async () => {
    // MV3 kills the service worker; durability comes from the database, not from
    // anything the facade holds. Build a fresh facade over the same store and
    // the Folder and its post are still there.
    const store = await createCollectionStore({
      indexedDB: new IDBFactory(),
      keyRange: IDBKeyRange,
    });
    const before = worker(store);
    const folder = (
      (await before.run({
        type: TYPE,
        operation: "create-folder",
        name: "Research",
        token: await before.token(),
      })) as { folder: { folderId: string } }
    ).folder;
    await before.run({
      type: TYPE,
      operation: "save-post",
      folderId: folder.folderId,
      capture: capture(STATUS),
      token: await before.token(),
    });

    const after = worker(store);
    expect(
      await after.run({ type: TYPE, operation: "list-folders", includeDeleted: false }),
    ).toEqual({ folders: [expect.objectContaining({ name: "Research" })] });
    expect(await after.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 1, savedPosts: 1 },
    });
  });
});

describe("collections writes share the worker's serialized queue", () => {
  it("observes interleaved collections and settings work in submission order", async () => {
    const w = worker();
    const order: string[] = [];
    const folder = (
      (await w.run({
        type: TYPE,
        operation: "create-folder",
        name: "A",
        token: await w.token(),
      })) as { folder: { folderId: string } }
    ).folder;

    await Promise.all([
      w
        .run({
          type: TYPE,
          operation: "save-post",
          folderId: folder.folderId,
          capture: capture(STATUS),
          token: await w.token(),
        })
        .then(() => order.push("save")),
      w.lifecycle.patchSettings({ highContrast: true }).then(() => order.push("settings")),
      w.run({ type: TYPE, operation: "counts" }).then(() => order.push("counts")),
    ]);

    expect(order).toEqual(["save", "settings", "counts"]);
    // The count saw the completed save, never a half-applied predecessor.
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 1, savedPosts: 1 },
    });
    expect((await w.lifecycle.readSettings()).highContrast).toBe(true);
  });
});

describe("the production store factory", () => {
  it("reads the browser's IndexedDB globals and nothing else", async () => {
    // The one place globals are read. Under the test environment there is no
    // indexedDB, so the factory degrades to the inert store rather than throwing
    // — the same answer a host with no database gets.
    const store = await defaultCollectionStore();
    expect(await store.listFolders({})).toEqual([]);
    expect(await store.countSavedPosts()).toBe(0);
  });
});
