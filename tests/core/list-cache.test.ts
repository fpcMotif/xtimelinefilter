import { describe, expect, it, vi } from "vitest";

import { createListCache, readCachedCatalog } from "@/core/list-cache";
import type { StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";
import type { Owner } from "@/packages/membership-store/types";
import type { XList } from "@/packages/x-client/types";

const A: Owner = { userId: "100", screenName: "alice" };
const B: Owner = { userId: "200", screenName: "bob" };
const A_LISTS: XList[] = [{ id: "1", name: "Research" }];
const B_LISTS: XList[] = [{ id: "2", name: "Friends" }];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function memoryArea(initial: Record<string, unknown> = {}): StorageLike {
  const values = { ...initial };
  return {
    async get() {
      return { ...values };
    },
    async set(items) {
      Object.assign(values, items);
    },
  };
}

describe("createListCache", () => {
  it("uses chrome local storage when no cache area is supplied", async () => {
    const cache = createListCache(async () => A_LISTS);

    await cache.refresh(A);

    expect(await cache.cached(A)).toEqual(A_LISTS);
  });

  it("isolates cached Lists by Owner", async () => {
    const loader = vi.fn(async (owner: Owner | null) =>
      owner?.userId === A.userId ? A_LISTS : B_LISTS,
    );
    const cache = createListCache(loader, { area: memoryArea() });

    expect(await cache.cached(A)).toBeNull();
    expect(await cache.refresh(A)).toEqual(A_LISTS);
    expect(await cache.refresh(B)).toEqual(B_LISTS);
    expect(await cache.cached(A)).toEqual(A_LISTS);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("refetches one Owner when forced and stores an authoritative empty result", async () => {
    let lists = A_LISTS;
    const cache = createListCache(async () => lists, { area: memoryArea() });
    await cache.refresh(A);
    lists = [];

    expect(await cache.refresh(A)).toEqual([]);
    expect(await cache.cached(A)).toEqual([]);
  });

  it("loads without caching when Owner discovery is unavailable", async () => {
    const loader = vi.fn(async () => A_LISTS);
    const cache = createListCache(loader, { area: memoryArea() });

    expect(await cache.cached(null)).toBeNull();
    expect(await cache.refresh(null)).toEqual(A_LISTS);
    expect(await cache.cached(A)).toBeNull();
    expect(loader).toHaveBeenCalledWith(null);
  });

  it("never attributes the legacy global cache to an Owner", async () => {
    const legacy = [{ id: "old", name: "Unknown Owner" }];
    const loader = vi.fn(async () => A_LISTS);
    const cache = createListCache(loader, {
      area: memoryArea({ [STORAGE_KEYS.lists]: legacy }),
    });

    expect(await cache.cached(A)).toBeNull();
    expect(await cache.refresh(A)).toEqual(A_LISTS);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("reads the Owner-qualified catalog for settings", async () => {
    const area = memoryArea();
    const cache = createListCache(
      async (owner) => (owner?.userId === A.userId ? A_LISTS : B_LISTS),
      { area },
    );
    await cache.refresh(A);
    await cache.refresh(B);

    expect(await readCachedCatalog(area)).toEqual([
      { owner: A, lists: A_LISTS },
      { owner: B, lists: B_LISTS },
    ]);
  });

  it("drops malformed Owner-qualified rows", async () => {
    const area = memoryArea({
      "lasso:lists:bad": { schema: 1, owner: null, lists: "wrong", refreshedAt: "wrong" },
      "lasso:lists:array": [],
    });
    expect(await readCachedCatalog(area)).toEqual([]);
  });

  it("returns X's answer when cache persistence fails", async () => {
    const area: StorageLike = {
      async get() {
        return {};
      },
      async set() {
        throw new Error("storage unavailable");
      },
    };
    const cache = createListCache(async () => A_LISTS, { area });

    await expect(cache.refresh(A)).resolves.toEqual(A_LISTS);
  });

  it("persists only the latest same-Owner refresh while returning both answers", async () => {
    let resolveOld!: (lists: XList[]) => void;
    let resolveNew!: (lists: XList[]) => void;
    const oldLists: XList[] = [{ id: "old", name: "Old" }];
    const newLists: XList[] = [{ id: "new", name: "New" }];
    const loader = vi
      .fn<(_: Owner | null) => Promise<XList[]>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNew = resolve)));
    const cache = createListCache(loader, { area: memoryArea() });

    const oldRefresh = cache.refresh(A);
    const newRefresh = cache.refresh(A);
    resolveNew(newLists);
    await expect(newRefresh).resolves.toEqual(newLists);
    resolveOld(oldLists);
    await expect(oldRefresh).resolves.toEqual(oldLists);

    expect(await cache.cached(A)).toEqual(newLists);
  });

  it("serializes same-Owner persistence so a blocked R1 cannot overwrite R2", async () => {
    const firstWrite = deferred<void>();
    const trace: string[] = [];
    const values: Record<string, unknown> = {};
    let writes = 0;
    const area: StorageLike = {
      async get() {
        return { ...values };
      },
      async set(items) {
        writes += 1;
        const lists = (Object.values(items)[0] as { lists: XList[] }).lists;
        const label = lists[0]!.name;
        trace.push(`set:start:${label}`);
        if (writes === 1) await firstWrite.promise;
        Object.assign(values, items);
        trace.push(`set:end:${label}`);
      },
    };
    const oldLists: XList[] = [{ id: "old", name: "R1" }];
    const newLists: XList[] = [{ id: "new", name: "R2" }];
    const loader = vi
      .fn<(_: Owner | null) => Promise<XList[]>>()
      .mockResolvedValueOnce(oldLists)
      .mockResolvedValueOnce(newLists);
    const cache = createListCache(loader, { area });

    const first = cache.refresh(A);
    await vi.waitFor(() => expect(trace).toEqual(["set:start:R1"]));
    const second = cache.refresh(A);
    await Promise.resolve();
    expect(trace).toEqual(["set:start:R1"]);

    firstWrite.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([oldLists, newLists]);
    expect(trace).toEqual(["set:start:R1", "set:end:R1", "set:start:R2", "set:end:R2"]);
    expect(await cache.cached(A)).toEqual(newLists);
  });

  it("rejects a queued refresh when Owner changes before persistence starts", async () => {
    const firstWrite = deferred<void>();
    const values: Record<string, unknown> = {};
    const set = vi.fn(async (items: Record<string, unknown>) => {
      if (set.mock.calls.length === 1) await firstWrite.promise;
      Object.assign(values, items);
    });
    const area: StorageLike = {
      async get() {
        return { ...values };
      },
      set,
    };
    let currentOwner: Owner | null = A;
    const loader = vi
      .fn<(_: Owner | null) => Promise<XList[]>>()
      .mockResolvedValueOnce(A_LISTS)
      .mockResolvedValueOnce([{ id: "new", name: "New" }]);
    const cache = createListCache(loader, { area, currentOwner: () => currentOwner });

    const first = cache.refresh(A);
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    const second = cache.refresh(A);
    await Promise.resolve();
    expect(set).toHaveBeenCalledOnce();

    currentOwner = B;
    firstWrite.resolve();
    await expect(first).resolves.toEqual(A_LISTS);
    await expect(second).rejects.toMatchObject({ name: "ListCacheOwnerChangedError" });
    expect(set).toHaveBeenCalledOnce();
  });

  it("does not suppress a different Owner's refresh", async () => {
    let resolveA!: (lists: XList[]) => void;
    let resolveB!: (lists: XList[]) => void;
    const loader = vi
      .fn<(_: Owner | null) => Promise<XList[]>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveB = resolve)));
    const cache = createListCache(loader, { area: memoryArea() });

    const refreshA = cache.refresh(A);
    const refreshB = cache.refresh(B);
    resolveB(B_LISTS);
    resolveA(A_LISTS);
    await expect(Promise.all([refreshA, refreshB])).resolves.toEqual([A_LISTS, B_LISTS]);

    await expect(cache.cached(A)).resolves.toEqual(A_LISTS);
    await expect(cache.cached(B)).resolves.toEqual(B_LISTS);
  });

  it("rejects an Owner's stale fetch and leaves its cache empty", async () => {
    let resolve!: (lists: XList[]) => void;
    let currentOwner: Owner | null = A;
    const area = memoryArea();
    const cache = createListCache(() => new Promise<XList[]>((done) => (resolve = done)), {
      area,
      currentOwner: () => currentOwner,
    });

    const refresh = cache.refresh(A);
    currentOwner = B;
    resolve(B_LISTS);

    await expect(refresh).rejects.toMatchObject({ name: "ListCacheOwnerChangedError" });
    expect(await cache.cached(A)).toBeNull();
  });

  it("rejects a null-Owner fetch after Owner discovery succeeds", async () => {
    let resolve!: (lists: XList[]) => void;
    let currentOwner: Owner | null = null;
    const cache = createListCache(() => new Promise<XList[]>((done) => (resolve = done)), {
      area: memoryArea(),
      currentOwner: () => currentOwner,
    });

    const refresh = cache.refresh(null);
    currentOwner = B;
    resolve(B_LISTS);

    await expect(refresh).rejects.toMatchObject({ name: "ListCacheOwnerChangedError" });
  });

  it("discards a catalog with an invalid Owner, timestamp, or List", async () => {
    const C: Owner = { userId: "300", screenName: "casey" };
    const area = memoryArea({
      "lasso:lists:100": {
        schema: 1,
        owner: A,
        lists: [...A_LISTS, { id: "broken", name: 1 }],
        refreshedAt: 1000,
      },
      "lasso:lists:200": {
        schema: 1,
        owner: { userId: B.userId, screenName: 1 },
        lists: B_LISTS,
        refreshedAt: 1000,
      },
      "lasso:lists:300": {
        schema: 1,
        owner: C,
        lists: [],
        refreshedAt: Number.POSITIVE_INFINITY,
      },
    });
    const cache = createListCache(async () => A_LISTS, { area });

    expect(await cache.cached(A)).toBeNull();
    expect(await readCachedCatalog(area)).toEqual([]);
  });

  it("rejects malformed optional List fields", async () => {
    for (const lists of [
      [{ id: "negative", name: "Negative", memberCount: -1 }],
      [{ id: "infinite", name: "Infinite", memberCount: Number.POSITIVE_INFINITY }],
      [{ id: "private", name: "Private", isPrivate: "yes" }],
    ]) {
      const area = memoryArea({
        "lasso:lists:100": { schema: 1, owner: A, lists, refreshedAt: 1000 },
      });
      expect(await readCachedCatalog(area)).toEqual([]);
    }
  });

  it("fails soft when storage returns a non-record payload", async () => {
    const area = {
      async get() {
        return [] as unknown as Record<string, unknown>;
      },
      async set() {},
    } satisfies StorageLike;
    const cache = createListCache(async () => A_LISTS, { area });

    await expect(readCachedCatalog(area)).resolves.toEqual([]);
    await expect(cache.cached(A)).resolves.toBeNull();
  });

  it("fails soft when cache storage cannot be read", async () => {
    const area: StorageLike = {
      async get() {
        throw new Error("storage unavailable");
      },
      async set() {},
    };
    const cache = createListCache(async () => A_LISTS, { area });

    await expect(cache.cached(A)).resolves.toBeNull();
    await expect(readCachedCatalog(area)).resolves.toEqual([]);
  });
});
