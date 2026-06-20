import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageLike } from "@/core/settings";
import { syncedStore } from "@/core/synced-store";

interface Shape {
  a: number;
  b: string;
}
const DEFAULTS: Shape = { a: 0, b: "x" };
const KEY = "lasso:test";

/** In-memory StorageLike, optionally seeded; mirrors the chrome.storage areas. */
function fakeStorage(seed: Record<string, unknown> = {}): StorageLike {
  const data: Record<string, unknown> = { ...seed };
  return {
    async get(keys?: string | string[] | null) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items);
    },
  };
}

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
/** Install a chrome.storage.onChanged so syncedStore's internal watcher fires. */
function installOnChanged() {
  const chromeMock = globalThis as unknown as { chrome: { storage: Record<string, unknown> } };
  const prev = chromeMock.chrome.storage.onChanged;
  const listeners: Listener[] = [];
  chromeMock.chrome.storage.onChanged = {
    addListener: (l: Listener) => listeners.push(l),
    removeListener: () => {},
  };
  return {
    emit: (raw: unknown, area = "sync") => {
      for (const l of listeners) l({ [KEY]: { newValue: raw } }, area);
    },
    restore: () => {
      chromeMock.chrome.storage.onChanged = prev;
    },
  };
}

describe("syncedStore", () => {
  it("current() returns defaults before hydrate, and the merged stored value after", async () => {
    const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage({ [KEY]: { a: 5 } }));
    expect(store.current()).toEqual(DEFAULTS);
    await store.hydrate();
    expect(store.current()).toEqual({ a: 5, b: "x" }); // merged over defaults
  });

  it("hydrate() reads storage only once (idempotent — the cached read)", async () => {
    const area = fakeStorage({ [KEY]: { a: 5 } });
    const getSpy = vi.spyOn(area, "get");
    const store = syncedStore<Shape>(KEY, DEFAULTS, area);
    await store.hydrate();
    await store.hydrate();
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("write() updates the cache and persists to storage", async () => {
    const area = fakeStorage();
    const store = syncedStore<Shape>(KEY, DEFAULTS, area);
    await store.write({ a: 9, b: "y" });
    expect(store.current()).toEqual({ a: 9, b: "y" });
    expect((await area.get(KEY))[KEY]).toEqual({ a: 9, b: "y" });
  });

  it("write() is strict — a storage rejection propagates", async () => {
    const area: StorageLike = {
      get: async () => ({}),
      set: () => Promise.reject(new Error("boom")),
    };
    const store = syncedStore<Shape>(KEY, DEFAULTS, area);
    await expect(store.write({ a: 1, b: "z" })).rejects.toThrow("boom");
  });

  describe("onExternalChange (cross-context)", () => {
    let bridge: ReturnType<typeof installOnChanged> | undefined;
    afterEach(() => {
      bridge?.restore();
      bridge = undefined;
    });

    it("adopts another context's write (merge over defaults, update cache, fire cb)", () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      bridge.emit({ a: 7 });
      expect(store.current()).toEqual({ a: 7, b: "x" });
      expect(cb).toHaveBeenCalledWith({ a: 7, b: "x" });
    });

    it("merges a cleared (undefined) external value over defaults", () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      bridge.emit(undefined);
      expect(cb).toHaveBeenCalledWith(DEFAULTS);
    });

    it("drops the echo of our own write", async () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.write({ a: 3, b: "w" }); // stamps the echo
      bridge.emit({ a: 3, b: "w" }); // identical → ignored
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
