import { afterEach, describe, expect, it, vi } from "vitest";

import type { StorageLike } from "@/core/storage-areas";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Install a chrome.storage.onChanged so syncedStore's internal watcher fires. */
function installOnChanged() {
  const bridge = installOnChangedFake();
  return {
    emit: (raw: unknown, area: "sync" | "local" = "sync", old: unknown = undefined) =>
      bridge.emit(KEY, raw, area, old),
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

    const primitive = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage({ [KEY]: "bad" }));
    await primitive.hydrate();
    expect(primitive.current()).toEqual(DEFAULTS);
  });

  it("hydrate() reads storage only once (idempotent — the cached read)", async () => {
    const area = fakeStorage({ [KEY]: { a: 5 } });
    const getSpy = vi.spyOn(area, "get");
    const store = syncedStore<Shape>(KEY, DEFAULTS, area);
    await store.hydrate();
    await store.hydrate();
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent hydrate calls into one read", async () => {
    const read = deferred<Record<string, unknown>>();
    const area: StorageLike = { get: vi.fn(() => read.promise), set: vi.fn(async () => {}) };
    const store = syncedStore<Shape>(KEY, DEFAULTS, area);

    const first = store.hydrate();
    const second = store.hydrate();
    expect(first).toBe(second);
    expect(area.get).toHaveBeenCalledTimes(1);
    read.resolve({ [KEY]: { a: 5 } });
    await first;
    expect(store.current()).toEqual({ a: 5, b: "x" });
  });

  it("keeps an external event that lands while hydrate is pending", async () => {
    const read = deferred<Record<string, unknown>>();
    const area: StorageLike = { get: () => read.promise, set: vi.fn(async () => {}) };
    const store = syncedStore<Shape>(KEY, DEFAULTS, area);
    const bridge = installOnChanged();
    try {
      store.onExternalChange(vi.fn());

      const hydrate = store.hydrate();
      bridge.emit({ a: 7 });
      read.resolve({ [KEY]: { a: 1 } });
      await hydrate;
      expect(store.current()).toEqual({ a: 7, b: "x" });
    } finally {
      bridge.restore();
    }
  });

  it("does not let a late hydrate overwrite a newer cache write", async () => {
    const read = deferred<Record<string, unknown>>();
    const area: StorageLike = { get: () => read.promise, set: vi.fn(async () => {}) };
    const store = syncedStore<Shape>(KEY, DEFAULTS, area);

    const hydrate = store.hydrate();
    await store.write({ a: 9, b: "new" });
    read.resolve({ [KEY]: { a: 1, b: "old" } });
    await hydrate;
    expect(store.current()).toEqual({ a: 9, b: "new" });
  });

  it("keeps hydrate's persisted value when an early optimistic write rejects", async () => {
    const read = deferred<Record<string, unknown>>();
    const store = syncedStore<Shape>(KEY, DEFAULTS, {
      get: () => read.promise,
      set: () => Promise.reject(new Error("write failed")),
    });

    const hydrate = store.hydrate();
    await expect(store.write({ a: 9, b: "optimistic" })).rejects.toThrow("write failed");
    read.resolve({ [KEY]: { a: 4, b: "persisted" } });
    await hydrate;
    expect(store.current()).toEqual({ a: 4, b: "persisted" });
  });

  it("retries after a failed hydrate", async () => {
    const area: StorageLike = {
      get: vi
        .fn<StorageLike["get"]>()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ [KEY]: { a: 6 } }),
      set: vi.fn(async () => {}),
    };
    const store = syncedStore<Shape>(KEY, DEFAULTS, area);

    await expect(store.hydrate()).rejects.toThrow("boom");
    await store.hydrate();
    expect(area.get).toHaveBeenCalledTimes(2);
    expect(store.current()).toEqual({ a: 6, b: "x" });
  });

  it("turns a synchronous get() throw into a retryable hydrate rejection", async () => {
    let calls = 0;
    const store = syncedStore<Shape>(KEY, DEFAULTS, {
      get: () => {
        calls += 1;
        if (calls === 1) throw new Error("sync boom");
        return Promise.resolve({ [KEY]: { a: 8 } });
      },
      set: async () => {},
    });

    await expect(store.hydrate()).rejects.toThrow("sync boom");
    await store.hydrate();
    expect(store.current()).toEqual({ a: 8, b: "x" });
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

  it("turns a synchronous set() throw into the same strict write rejection", async () => {
    const store = syncedStore<Shape>(KEY, DEFAULTS, {
      get: async () => ({}),
      set: () => {
        throw new Error("sync boom");
      },
    });

    await expect(store.write({ a: 1, b: "z" })).rejects.toThrow("sync boom");
    expect(store.current()).toEqual(DEFAULTS);
  });

  it("keeps a cyclic optimistic value comparable by identity when a storage seam accepts it", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const store = syncedStore<Record<string, unknown>>(
      KEY,
      {},
      {
        get: async () => ({}),
        set: async () => {},
      },
    );

    await expect(store.write(cyclic)).resolves.toBe(cyclic);
    expect(store.current()).toBe(cyclic);
  });

  it("returns the confirmed baseline after two overlapping writes reject", async () => {
    let rejectFirst!: (e: Error) => void;
    let calls = 0;
    const store = syncedStore<Shape>(KEY, DEFAULTS, {
      get: async () => ({}),
      set: () =>
        ++calls === 1
          ? new Promise<void>((_, reject) => {
              rejectFirst = reject;
            })
          : Promise.reject(new Error("second failed")),
    });
    const first = store.write({ a: 1, b: "old" });
    const second = store.write({ a: 2, b: "new" });
    expect(store.current()).toEqual({ a: 2, b: "new" });
    rejectFirst(new Error("boom"));
    await expect(first).rejects.toThrow("boom");
    await expect(second).rejects.toThrow("second failed");
    expect(store.current()).toEqual(DEFAULTS);
  });

  it("keeps W1 as confirmed authority when W1 succeeds and W2 rejects", async () => {
    const firstWrite = deferred<void>();
    let calls = 0;
    const persisted: Shape[] = [];
    const store = syncedStore<Shape>(KEY, DEFAULTS, {
      get: async () => ({}),
      set: (items) => {
        persisted.push(items[KEY] as Shape);
        return ++calls === 1 ? firstWrite.promise : Promise.reject(new Error("W2 failed"));
      },
    });
    const first = store.write({ a: 1, b: "W1" });
    const second = store.write({ a: 2, b: "W2" });
    firstWrite.resolve();
    await first;
    await expect(second).rejects.toThrow("W2 failed");
    expect(persisted).toEqual([
      { a: 1, b: "W1" },
      { a: 2, b: "W2" },
    ]);
    expect(store.current()).toEqual({ a: 1, b: "W1" });
  });

  it("keeps W2 as confirmed authority when W1 rejects and W2 succeeds", async () => {
    const firstWrite = deferred<void>();
    let calls = 0;
    const store = syncedStore<Shape>(KEY, DEFAULTS, {
      get: async () => ({}),
      set: () => (++calls === 1 ? firstWrite.promise : Promise.resolve()),
    });
    const first = store.write({ a: 1, b: "W1" });
    const second = store.write({ a: 2, b: "W2" });
    firstWrite.reject(new Error("W1 failed"));
    await expect(first).rejects.toThrow("W1 failed");
    await second;
    expect(store.current()).toEqual({ a: 2, b: "W2" });
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
      expect(cb).toHaveBeenCalledWith({ a: 7, b: "x" }, DEFAULTS);
    });

    it("adopts a distinct external change after the local cache is known", async () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.hydrate();

      bridge.emit({ a: 7, b: "Q" }, "sync", DEFAULTS);
      expect(store.current()).toEqual({ a: 7, b: "Q" });
      expect(cb).toHaveBeenCalledWith({ a: 7, b: "Q" }, DEFAULTS);
    });

    it("merges a cleared (undefined) external value over defaults", () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      bridge.emit({ a: 1 });
      cb.mockClear();
      bridge.emit(undefined, "sync", { a: 1 });
      expect(cb).toHaveBeenCalledWith(DEFAULTS, { a: 1, b: "x" });
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

    it("confirms a matching event while set() is pending without firing a callback", async () => {
      bridge = installOnChanged();
      const pendingSet = deferred<void>();
      const store = syncedStore<Shape>(KEY, DEFAULTS, {
        get: async () => ({}),
        set: () => pendingSet.promise,
      });
      const cb = vi.fn();
      store.onExternalChange(cb);
      const write = store.write({ a: 3, b: "same" });

      bridge.emit({ a: 3, b: "same" });
      expect(store.current()).toEqual({ a: 3, b: "same" });
      expect(cb).not.toHaveBeenCalled();

      pendingSet.reject(new Error("local failure"));
      await expect(write).rejects.toThrow("local failure");
      expect(store.current()).toEqual({ a: 3, b: "same" });
      expect(cb).not.toHaveBeenCalled();
    });

    it("fences a started W1 after external Q; queued W2 reasserts only when its set starts", async () => {
      bridge = installOnChanged();
      const firstSet = deferred<void>();
      const secondSet = deferred<void>();
      let calls = 0;
      const store = syncedStore<Shape>(KEY, DEFAULTS, {
        get: async () => ({}),
        set: () => (++calls === 1 ? firstSet.promise : secondSet.promise),
      });
      const cb = vi.fn();
      store.onExternalChange(cb);
      const first = store.write({ a: 1, b: "P" });
      const second = store.write({ a: 2, b: "R" });

      bridge.emit({ a: 3, b: "Q" }, "sync", DEFAULTS);
      expect(store.current()).toEqual({ a: 3, b: "Q" });
      expect(cb).toHaveBeenCalledWith({ a: 3, b: "Q" }, DEFAULTS);

      firstSet.resolve();
      await expect(first).resolves.toEqual({ a: 3, b: "Q" });
      await vi.waitFor(() => expect(calls).toBe(2));
      expect(store.current()).toEqual({ a: 2, b: "R" });
      expect(cb).toHaveBeenCalledTimes(1); // local reassertion is not an external event

      secondSet.resolve();
      await expect(second).resolves.toEqual({ a: 2, b: "R" });
      expect(store.current()).toEqual({ a: 2, b: "R" });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("cancels a guarded queued write when newer authority wins before persistence", async () => {
      bridge = installOnChanged();
      const firstSet = deferred<void>();
      const set = vi.fn(() => firstSet.promise);
      const store = syncedStore<Shape>(KEY, DEFAULTS, {
        get: async () => ({}),
        set,
      });
      store.onExternalChange(vi.fn());
      const p = { a: 1, b: "P" };
      const b = { a: 2, b: "B" };
      const repair = { a: 3, b: "repair-B" };
      const c = { a: 4, b: "C" };

      const first = store.write(p);
      bridge.emit(b, "sync", p);
      const guarded = store.write(repair, b);
      bridge.emit(c, "sync", b);
      firstSet.resolve();

      await expect(first).resolves.toEqual(c);
      await expect(guarded).resolves.toEqual(c);
      expect(set).toHaveBeenCalledTimes(1);
      expect(store.current()).toEqual(c);
    });

    it("returns Q and restores Q when external Q fences W1 and queued W2 fails", async () => {
      bridge = installOnChanged();
      const firstSet = deferred<void>();
      let calls = 0;
      const store = syncedStore<Shape>(KEY, DEFAULTS, {
        get: async () => ({}),
        set: () => (++calls === 1 ? firstSet.promise : Promise.reject(new Error("W2 failed"))),
      });
      store.onExternalChange(vi.fn());
      const first = store.write({ a: 1, b: "P" });
      const second = store.write({ a: 2, b: "R" });

      bridge.emit({ a: 3, b: "Q" }, "sync", DEFAULTS);
      firstSet.resolve();

      await expect(first).resolves.toEqual({ a: 3, b: "Q" });
      await expect(second).rejects.toThrow("W2 failed");
      expect(store.current()).toEqual({ a: 3, b: "Q" });
    });

    it("shares one raw watcher across subscribers and stops it after the last disposer", async () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const first = vi.fn();
      const second = vi.fn();
      const disposeFirst = store.onExternalChange(first);
      const disposeSecond = store.onExternalChange(second);
      const p = { a: 1, b: "P" };
      const q = { a: 2, b: "Q" };
      const r = { a: 3, b: "R" };
      await store.write(p);

      bridge.emit(p, "sync", DEFAULTS); // local echo: neither subscriber fires
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();

      bridge.emit(q, "sync", p);
      expect(first).toHaveBeenCalledWith(q, p);
      expect(second).toHaveBeenCalledWith(q, p);
      disposeFirst();

      bridge.emit(r, "sync", q);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledWith(r, q);
      disposeSecond();

      bridge.emit({ a: 4, b: "S" }, "sync", r);
      expect(store.current()).toEqual(r);
      expect(second).toHaveBeenCalledTimes(2);
    });

    it("adopts Q → P after an unhydrated same-value write without an echo", async () => {
      bridge = installOnChanged();
      const p = { a: 1, b: "P" };
      const q = { a: 2, b: "Q" };
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage({ [KEY]: p }));
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.write(p); // underlying storage already held P, so no echo arrives

      bridge.emit(q, "sync", p);
      bridge.emit(p, "sync", q);
      expect(cb).toHaveBeenNthCalledWith(1, q, p);
      expect(cb).toHaveBeenNthCalledWith(2, p, q);
      expect(store.current()).toEqual(p);
    });

    it("ignores a delayed P echo after Q has become authority", async () => {
      bridge = installOnChanged();
      const p = { a: 1, b: "P" };
      const q = { a: 2, b: "Q" };
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.write(p);

      bridge.emit(q, "sync", p);
      bridge.emit(p, "sync", DEFAULTS); // a late echo of the earlier local P
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(q, p);
      expect(store.current()).toEqual(q);
    });

    it("does not let P's late echo displace queued R", async () => {
      bridge = installOnChanged();
      const secondSet = deferred<void>();
      let calls = 0;
      const p = { a: 1, b: "P" };
      const r = { a: 2, b: "R" };
      const store = syncedStore<Shape>(KEY, DEFAULTS, {
        get: async () => ({}),
        set: () => (++calls === 1 ? Promise.resolve() : secondSet.promise),
      });
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.write(p);
      const second = store.write(r);
      await vi.waitFor(() => expect(calls).toBe(2));

      bridge.emit(p, "sync", DEFAULTS);
      expect(store.current()).toEqual(r);
      expect(cb).not.toHaveBeenCalled();

      secondSet.resolve();
      await second;
    });

    it("ignores a no-op echo of the confirmed value without displacing a queued write", async () => {
      bridge = installOnChanged();
      const secondSet = deferred<void>();
      let calls = 0;
      const p = { a: 1, b: "P" };
      const r = { a: 2, b: "R" };
      const store = syncedStore<Shape>(KEY, DEFAULTS, {
        get: async () => ({}),
        set: () => (++calls === 1 ? Promise.resolve() : secondSet.promise),
      });
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.write(p); // confirmed = P, authority known
      const second = store.write(r); // R optimistic, its own set() still in flight
      await vi.waitFor(() => expect(calls).toBe(2));

      bridge.emit(p, "sync", p); // a P→P echo of the confirmed value: no new authority
      expect(store.current()).toEqual(r); // queued optimistic R must survive
      expect(cb).not.toHaveBeenCalled();

      secondSet.resolve();
      await second;
      expect(store.current()).toEqual(r);
    });

    it("does not suppress external Q → P after duplicate local P writes", async () => {
      bridge = installOnChanged();
      const p = { a: 1, b: "P" };
      const q = { a: 2, b: "Q" };
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.write(p);
      await store.write(p);

      bridge.emit(p, "sync", DEFAULTS); // delayed echo from the first P
      bridge.emit(q, "sync", p);
      bridge.emit(p, "sync", q);
      expect(cb).toHaveBeenNthCalledWith(1, q, p);
      expect(cb).toHaveBeenNthCalledWith(2, p, q);
      expect(store.current()).toEqual(p);
    });

    it("watches the injected areaName — a 'local' store ignores sync-area changes", () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage(), "local");
      const cb = vi.fn();
      store.onExternalChange(cb);
      bridge.emit({ a: 7 }, "sync"); // wrong area — not ours
      expect(cb).not.toHaveBeenCalled();
      bridge.emit({ a: 7 }, "local"); // our area — adopted
      expect(cb).toHaveBeenCalledWith({ a: 7, b: "x" }, DEFAULTS);
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
      expect(cb).toHaveBeenCalledWith({ a: 1, b: "z" }, DEFAULTS); // …not swallowed as a stale echo
    });

    it("drops BOTH echoes under two rapid same-context writes — no flicker", async () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      store.onExternalChange(cb);
      await store.write({ a: 1, b: "p" });
      await store.write({ a: 2, b: "q" }); // second write before the first echo returns
      bridge.emit({ a: 1, b: "p" }, "sync", DEFAULTS); // earlier echo first...
      bridge.emit({ a: 2, b: "q" }, "sync", { a: 1, b: "p" }); // ...then later
      expect(cb).not.toHaveBeenCalled(); // neither is mistaken for an external write
      expect(store.current()).toEqual({ a: 2, b: "q" }); // never regressed to {a:1} (the old single-slot bug)
    });

    it("returns an idempotent disposer", () => {
      bridge = installOnChanged();
      const store = syncedStore<Shape>(KEY, DEFAULTS, fakeStorage());
      const cb = vi.fn();
      const dispose = store.onExternalChange(cb);
      dispose();
      dispose();
      bridge.emit({ a: 7 });
      expect(cb).not.toHaveBeenCalled();
      expect(store.current()).toEqual(DEFAULTS);
    });
  });
});
