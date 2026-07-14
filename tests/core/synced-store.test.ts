import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageLike } from "@/core/settings";
import { syncedStore } from "@/core/synced-store";

import { createMemoryArea, installOnChanged as installOnChangedFake } from "../helpers/chrome-fake";

interface Shape {
  a: number;
  b: string;
}
const DEFAULTS: Shape = { a: 0, b: "x" };
const KEY = "lasso:test";

function fakeStorage(seed: Record<string, unknown> = {}): StorageLike {
  return createMemoryArea(seed);
}

/** Install a chrome.storage.onChanged so syncedStore's internal watcher fires. */
function installOnChanged() {
  const bridge = installOnChangedFake();
  return {
    emit: (raw: unknown, area: "sync" | "local" = "sync") => bridge.emit(KEY, raw, area),
    restore: bridge.restore,
  };
}

describe("syncedStore", () => {
  it("current() returns defaults before hydrate, and the merged stored value after", async () => {
    const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage({ [KEY]: { a: 5 } }));
    expect(store.current()).toEqual(DEFAULTS);
    await store.hydrate();
    expect(store.current()).toEqual({ a: 5, b: "x" }); // merged over defaults
  });

  it("deep-merges nested object defaults but replaces arrays/non-objects wholesale", async () => {
    const D = { a: 0, nested: { x: 1, y: 2 }, tags: ["d"] };
    // A legacy stored value missing `nested.y` (added to defaults in a later version).
    const seeded = syncedStore(
      KEY,
      D,
      fakeStorage({ [KEY]: { a: 5, nested: { x: 9 }, tags: ["s"] } }),
    );
    await seeded.hydrate();
    expect(seeded.current()).toEqual({ a: 5, nested: { x: 9, y: 2 }, tags: ["s"] }); // y backfilled, array replaced

    // A corrupt/legacy null under a nested-object key falls back to the default object, not null.
    const corrupt = syncedStore(KEY, D, fakeStorage({ [KEY]: { nested: null } }));
    await corrupt.hydrate();
    expect(corrupt.current().nested).toEqual({ x: 1, y: 2 });
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

  it("a failed write never clobbers a newer write's cache (last-wins preserved)", async () => {
    let rejectFirst!: (e: Error) => void;
    let calls = 0;
    const store = syncedStore<Shape>(KEY, DEFAULTS, {
      get: async () => ({}),
      set: () =>
        ++calls === 1
          ? new Promise<void>((_, reject) => {
              rejectFirst = reject;
            })
          : Promise.resolve(),
    });
    const first = store.write({ a: 1, b: "old" });
    await store.write({ a: 2, b: "new" }); // supersedes while the first is still in flight
    rejectFirst(new Error("boom"));
    await expect(first).rejects.toThrow("boom");
    expect(store.current()).toEqual({ a: 2, b: "new" }); // rollback skipped — the newer write owns the cache
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

    it("watches the injected areaName — a 'local' store ignores sync-area changes", () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage(), "local");
      const cb = vi.fn();
      store.onExternalChange(cb);
      bridge.emit({ a: 7 }, "sync"); // wrong area — not ours
      expect(cb).not.toHaveBeenCalled();
      bridge.emit({ a: 7 }, "local"); // our area — adopted
      expect(cb).toHaveBeenCalledWith({ a: 7, b: "x" });
    });

    it("a rejected write rolls the cache back and retires its echo", async () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, {
        get: async () => ({}),
        set: () => Promise.reject(new Error("boom")),
      });
      const cb = vi.fn();
      store.onExternalChange(cb);
      await expect(store.write({ a: 1, b: "z" })).rejects.toThrow("boom");
      expect(store.current()).toEqual(DEFAULTS); // failure must not read back as success
      bridge.emit({ a: 1, b: "z" }); // the same payload arriving later is a REAL external change…
      expect(cb).toHaveBeenCalledWith({ a: 1, b: "z" }); // …not swallowed as a stale echo
    });

    it("drops BOTH echoes under two rapid same-context writes — no flicker", async () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.write({ a: 1, b: "p" });
      await store.write({ a: 2, b: "q" }); // second write before the first echo returns
      bridge.emit({ a: 1, b: "p" }); // FIFO: the earlier echo arrives first...
      bridge.emit({ a: 2, b: "q" }); // ...then the later one
      expect(cb).not.toHaveBeenCalled(); // neither is mistaken for an external write
      expect(store.current()).toEqual({ a: 2, b: "q" }); // never regressed to {a:1} (the old single-slot bug)
    });
  });
});
