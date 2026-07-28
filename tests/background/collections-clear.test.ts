import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { createDataLifecycle } from "@/background/data-lifecycle";
import {
  createCollections,
  defaultDatabaseDestroyer,
  type CollectionStoreFactory,
  type DatabaseDestroyer,
} from "@/background/data-lifecycle/collections";
import type { CacheObservation } from "@/core/cache-observation";
import type { CollectionsRequest } from "@/core/protocol/collections";
import { COLLECTIONS_DATABASE, LOCAL_STORAGE_KEYS, STORAGE_KEYS } from "@/core/storage-keys";
import { FOLDERS_DB_NAME } from "@/packages/folders";
import type { CollectionStore, PostCapture } from "@/packages/folders/types";

import { createMemoryArea } from "../helpers/chrome-fake";

const TYPE = "lasso:collections";
const STATUS = "1234567890";

const capture = (statusId: string): PostCapture => ({
  statusId,
  permalink: `https://x.com/jack/status/${statusId}`,
  media: [],
});

function build(options: { destroy?: DatabaseDestroyer; open?: CollectionStoreFactory } = {}) {
  const local = createMemoryArea();
  const indexedDB = new IDBFactory();
  const open: CollectionStoreFactory =
    options.open ??
    (async () => {
      const { createCollectionStore } = await import("@/packages/folders");
      return createCollectionStore({ indexedDB, keyRange: IDBKeyRange });
    });
  const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "mirror-id", {
    open,
    destroy: options.destroy ?? (async () => true),
  });
  const run = (request: CollectionsRequest) => lifecycle.collections(request);
  const token = async (): Promise<CacheObservation> =>
    ((await run({ type: TYPE, operation: "begin" })) as { token: CacheObservation }).token;
  return { local, lifecycle, run, token };
}

describe("declared names this ticket registers", () => {
  it("registers exactly these names, as an exact literal list", () => {
    // An exhaustive comparison, not spot checks: a key added to STORAGE_KEYS
    // later fails here until it is named, so nothing can be registered without
    // somebody deciding whether Clear should sweep it.
    expect(Object.entries(STORAGE_KEYS).toSorted()).toEqual(
      [
        ["lists", "lasso:lists"],
        ["listUsage", "lasso:list-usage"],
        ["settings", "lasso:settings"],
        ["settingsMigration", "lasso:settings-migration"],
        ["filter", "lasso:filter"],
        ["coach", "lasso:coach"],
        ["mirrorStatus", "lasso:mirror-status"],
        ["graphqlOps", "lasso.graphqlOps.v1"],
        ["graphqlCatalog", "lasso.graphqlCatalog.v2"],
        ["cacheObservation", "lasso:cache-observation"],
        ["destinationSecrets", "lasso:destination-secrets"],
      ].toSorted(),
    );
    expect(COLLECTIONS_DATABASE).toBe("lasso:folders");
    // One source of truth: the package owns the database and storage-keys
    // re-exports it, so these cannot drift into two different literals.
    expect(COLLECTIONS_DATABASE).toBe(FOLDERS_DB_NAME);
  });

  it("sweeps the reserved Destination-secrets key with the rest of local data", () => {
    // Registered now, while empty, so the later Destination ticket cannot add a
    // prefixed key that escapes Clear until somebody remembers to list it.
    expect(LOCAL_STORAGE_KEYS).toContain(STORAGE_KEYS.destinationSecrets);
  });

  it("keeps Destination secrets out of the settings record entirely", () => {
    // The popup holds a Settings read grant; a token must not be reachable
    // through it, so the key is not a LassoSettings field.
    expect(Object.values(STORAGE_KEYS)).toContain("lasso:destination-secrets");
    expect(STORAGE_KEYS.settings).not.toBe(STORAGE_KEYS.destinationSecrets);
  });
});

describe("Privacy Clear destroys the collections database", () => {
  it("reports localCleared only when the database went too", async () => {
    const destroyed = build({ destroy: async () => true });
    await expect(destroyed.lifecycle.clear()).resolves.toEqual({
      localCleared: true,
      syncCleared: true,
    });

    const survived = build({ destroy: async () => false });
    await expect(survived.lifecycle.clear()).resolves.toEqual({
      localCleared: false,
      syncCleared: true,
    });
  });

  it("keeps the clear response to two booleans, so no surface copy changes", async () => {
    const result = await build().lifecycle.clear();
    expect(Object.keys(result).toSorted()).toEqual(["localCleared", "syncCleared"]);
  });

  it("treats a destroyer that throws as a failed local clear", async () => {
    const thrown = build({
      destroy: () => Promise.reject(new Error("blocked by an open tab")),
    });
    await expect(thrown.lifecycle.clear()).resolves.toMatchObject({ localCleared: false });
  });

  it("closes the open connection before deleting, and reopens empty afterwards", async () => {
    let closed = 0;
    let opens = 0;
    const store = {
      close: () => {
        closed += 1;
      },
      countFolders: async () => 0,
      countSavedPosts: async () => 0,
    } as unknown as CollectionStore;
    const w = build({
      open: async () => {
        opens += 1;
        return store;
      },
    });

    await w.run({ type: TYPE, operation: "counts" });
    expect(opens).toBe(1);

    await w.lifecycle.clear();
    // An open connection blocks deleteDatabase, so Clear releases it first.
    expect(closed).toBe(1);

    await w.run({ type: TYPE, operation: "counts" });
    // The memoized store was dropped, so the next operation opens afresh.
    expect(opens).toBe(2);
  });

  it("clears without a store ever having been opened", async () => {
    let opens = 0;
    const w = build({
      open: async () => {
        opens += 1;
        return {} as CollectionStore;
      },
    });
    await expect(w.lifecycle.clear()).resolves.toMatchObject({ localCleared: true });
    expect(opens).toBe(0);
  });

  it("still clears when the store that was open cannot be closed", async () => {
    const w = build({
      open: async () =>
        ({
          close: () => {
            throw new Error("already gone");
          },
          countFolders: async () => 0,
          countSavedPosts: async () => 0,
        }) as unknown as CollectionStore,
    });
    await w.run({ type: TYPE, operation: "counts" });
    await expect(w.lifecycle.clear()).resolves.toMatchObject({ localCleared: true });
  });

  it("clears while an open is still in flight and about to fail", async () => {
    // Driven against the module directly: through the facade, Clear queues
    // behind the in-flight operation and the open has already settled.
    let failOpen!: (reason: Error) => void;
    const collections = createCollections(
      createMemoryArea(),
      () => new Promise<CollectionStore>((_resolve, reject) => (failOpen = reject)),
      async () => true,
    );
    const inFlight = collections.run({ type: TYPE, operation: "counts" });
    const destroying = collections.destroy();
    failOpen(new Error("quota"));

    await expect(inFlight).rejects.toThrow("could not be opened");
    // A failed open is nothing to close, and it must not fail the clear.
    await expect(destroying).resolves.toBe(true);
  });

  it("still clears when the store never opened successfully", async () => {
    const w = build({ open: async () => Promise.reject(new Error("quota")) });
    await expect(w.run({ type: TYPE, operation: "counts" })).rejects.toThrow("could not be opened");
    await expect(w.lifecycle.clear()).resolves.toMatchObject({ localCleared: true });
  });

  it("wipes real Folders and Saved Posts, not just the storage keys", async () => {
    // The destroyer here is the identity of the test: after Clear the store is
    // rebuilt over a fresh database, so nothing the user filed survives.
    const indexedDB = new IDBFactory();
    const local = createMemoryArea();
    let generation = 0;
    const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "mirror-id", {
      open: async () => {
        const { createCollectionStore } = await import("@/packages/folders");
        return createCollectionStore({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange });
      },
      destroy: async () => {
        generation += 1;
        return true;
      },
    });
    const run = (request: CollectionsRequest) => lifecycle.collections(request);
    const token = async () =>
      ((await run({ type: TYPE, operation: "begin" })) as { token: CacheObservation }).token;

    const folder = (
      (await run({
        type: TYPE,
        operation: "create-folder",
        name: "Research",
        token: await token(),
      })) as { folder: { folderId: string } }
    ).folder;
    await run({
      type: TYPE,
      operation: "save-post",
      folderId: folder.folderId,
      capture: capture(STATUS),
      token: await token(),
    });
    expect(await run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 1, savedPosts: 1 },
    });

    await lifecycle.clear();
    expect(generation).toBe(1);
    expect(await run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 0, savedPosts: 0 },
    });
    void indexedDB;
  });
});

describe("a write begun before Clear does not land after it", () => {
  it("refuses the stale token and accepts one minted afterwards", async () => {
    const w = build();
    // The user starts a save …
    const before = await w.token();

    // … and clears their data before it reaches the worker.
    await w.lifecycle.clear();

    await expect(
      w.run({ type: TYPE, operation: "create-folder", name: "Research", token: before }),
    ).rejects.toThrow("started before your data was cleared");
    expect(await w.run({ type: TYPE, operation: "counts" })).toEqual({
      counts: { folders: 0, savedPosts: 0 },
    });

    // A write begun AFTER the clear is ordinary work and succeeds.
    await expect(
      w.run({ type: TYPE, operation: "create-folder", name: "Research", token: await w.token() }),
    ).resolves.toMatchObject({ folder: expect.objectContaining({ name: "Research" }) });
  });
});

describe("the production database destroyer", () => {
  it("resolves true when there is no IndexedDB to delete", async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    await expect(defaultDatabaseDestroyer()).resolves.toBe(true);
  });

  it("resolves true on success and false when the delete errors or is blocked", async () => {
    for (const [event, expected] of [
      ["success", true],
      ["error", false],
      ["blocked", false],
    ] as const) {
      const listeners: Record<string, () => void> = {};
      vi.stubGlobal("indexedDB", {
        deleteDatabase: (name: string) => {
          expect(name).toBe(COLLECTIONS_DATABASE);
          queueMicrotask(() => listeners[event]?.());
          return {
            addEventListener: (type: string, listener: () => void) => {
              listeners[type] = listener;
            },
          };
        },
      });
      await expect(defaultDatabaseDestroyer(), event).resolves.toBe(expected);
      vi.unstubAllGlobals();
    }
  });
});
