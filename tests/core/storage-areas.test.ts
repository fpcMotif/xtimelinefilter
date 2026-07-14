import { describe, expect, it, vi } from "vitest";

import { blobStore, localArea, syncArea, type StorageLike } from "@/core/storage-areas";

import { createMemoryArea } from "../helpers/chrome-fake";

describe("syncArea / localArea", () => {
  it("front the matching chrome.storage area", async () => {
    const chromeMock = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    const syncSpy = vi.spyOn(chromeMock.storage.sync, "get");
    const localSpy = vi.spyOn(chromeMock.storage.local, "get");

    await syncArea().get("k");
    expect(syncSpy).toHaveBeenCalledWith("k");

    await localArea().get("k");
    expect(localSpy).toHaveBeenCalledWith("k");
  });
});

describe("blobStore", () => {
  const KEY = "lasso:blob-test";

  it("get() returns defaults when nothing is stored", async () => {
    const area = createMemoryArea();
    const store = blobStore<{ a: number }>(area, KEY, { a: 0 });
    expect(await store.get()).toEqual({ a: 0 });
  });

  it("get() returns the stored value verbatim once set", async () => {
    const area = createMemoryArea();
    const store = blobStore<{ a: number }>(area, KEY, { a: 0 });
    await store.set({ a: 7 });
    expect(await store.get()).toEqual({ a: 7 });
  });

  it("set() writes under the given key and returns the value", async () => {
    const area = createMemoryArea();
    const store = blobStore<{ a: number }>(area, KEY, { a: 0 });
    const written = await store.set({ a: 3 });
    expect(written).toEqual({ a: 3 });
    expect((await area.get(KEY))[KEY]).toEqual({ a: 3 });
  });

  it("supports non-object defaults (e.g. an empty array)", async () => {
    const area = createMemoryArea();
    const store = blobStore<string[]>(area, KEY, []);
    expect(await store.get()).toEqual([]);
    await store.set(["x", "y"]);
    expect(await store.get()).toEqual(["x", "y"]);
  });

  it("reads through a plain StorageLike, not just createMemoryArea", async () => {
    const data: Record<string, unknown> = { [KEY]: { a: 9 } };
    const area: StorageLike = {
      get: async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys ?? KEY];
        return Object.fromEntries(
          list.filter((k): k is string => k in data).map((k) => [k, data[k]]),
        );
      },
      set: async (items) => {
        Object.assign(data, items);
      },
    };
    const store = blobStore<{ a: number }>(area, KEY, { a: 0 });
    expect(await store.get()).toEqual({ a: 9 });
  });
});
