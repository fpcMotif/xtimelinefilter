import { describe, expect, it, vi } from "vitest";

import { createCoach, DECAY_ASSIGNS, DECAY_MS } from "@/core/coach";
import type { StorageLike } from "@/core/settings";

function memoryArea(seed: Record<string, unknown> = {}): StorageLike {
  const store: Record<string, unknown> = { ...seed };
  return {
    async get() {
      return { ...store };
    },
    async set(items) {
      Object.assign(store, items);
    },
  };
}

const T0 = Date.UTC(2026, 5, 1);

function coachAt(now: { t: number }, area = memoryArea()) {
  return createCoach(area, () => now.t);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createCoach", () => {
  it("uses its default storage and clock dependencies", async () => {
    const c = createCoach();
    await expect(c.isOnboarded()).resolves.toBe(false);
  });

  it("uses semantic worker commands when extension messaging is available", async () => {
    const previous = globalThis.chrome;
    const sendMessage = vi.fn(async () => ({ ok: true, result: { kind: "ok" } }));
    globalThis.chrome = { ...previous, runtime: { sendMessage } } as unknown as typeof chrome;

    try {
      await createCoach().markOnboarded();
      expect(sendMessage).toHaveBeenCalledWith({
        type: "lasso:coach",
        command: { kind: "mark-onboarded" },
      });
    } finally {
      globalThis.chrome = previous;
    }
  });

  it("submits worker commands in caller order when an assign and tip race", async () => {
    const previous = globalThis.chrome;
    const assigned = deferred<{ ok: true; result: { kind: "ok" } }>();
    let assignCount = DECAY_ASSIGNS - 1;
    const sendMessage = vi.fn((request: { command: { kind: string } }) => {
      if (request.command.kind === "record-assign") {
        return assigned.promise.then((response) => {
          assignCount += 1;
          return response;
        });
      }
      return Promise.resolve({
        ok: true,
        result: { kind: "try-show-tip", show: assignCount < DECAY_ASSIGNS },
      });
    });
    globalThis.chrome = { ...previous, runtime: { sendMessage } } as unknown as typeof chrome;

    try {
      const coach = createCoach();
      const assign = coach.recordAssign();
      const tip = coach.tryShowTip("post-assign");

      await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      expect(sendMessage).toHaveBeenCalledWith({
        type: "lasso:coach",
        command: { kind: "record-assign" },
      });

      assigned.resolve({ ok: true, result: { kind: "ok" } });
      await expect(assign).resolves.toBeUndefined();
      await expect(tip).resolves.toBe(false);
      expect(sendMessage).toHaveBeenNthCalledWith(2, {
        type: "lasso:coach",
        command: { kind: "try-show-tip", tip: "post-assign", max: 1 },
      });
    } finally {
      globalThis.chrome = previous;
    }
  });

  it("fails soft when worker messaging throws synchronously", async () => {
    const previous = globalThis.chrome;
    globalThis.chrome = {
      ...previous,
      runtime: {
        sendMessage() {
          throw new Error("Extension context invalidated");
        },
      },
    } as unknown as typeof chrome;

    try {
      const coach = createCoach();
      await expect(coach.isOnboarded()).resolves.toBe(true);
      await expect(coach.hintsActive()).resolves.toBe(false);
      await expect(coach.tryShowTip("first-hover")).resolves.toBe(false);
      await expect(coach.markOnboarded()).resolves.toBeUndefined();
      await expect(coach.recordAssign()).resolves.toBeUndefined();
      await expect(coach.replayIntro()).resolves.toBeUndefined();
    } finally {
      globalThis.chrome = previous;
    }
  });

  it("fails closed when a worker returns a result for the wrong command", async () => {
    const previous = globalThis.chrome;
    try {
      vi.resetModules();
      vi.doMock("@/core/protocol", async (importOriginal) => ({
        ...(await importOriginal<typeof import("@/core/protocol")>()),
        requestCoach: async () => ({ kind: "ok" }),
      }));
      const { createCoach: isolatedCreateCoach } = await import("@/core/coach");
      globalThis.chrome = {
        ...previous,
        runtime: { sendMessage: async () => ({ ok: true, result: { kind: "ok" } }) },
      } as unknown as typeof chrome;
      const coach = isolatedCreateCoach();
      await expect(coach.isOnboarded()).resolves.toBe(true);
      await expect(coach.hintsActive()).resolves.toBe(false);
      await expect(coach.tryShowTip("unit")).resolves.toBe(false);
    } finally {
      globalThis.chrome = previous;
      vi.doUnmock("@/core/protocol");
      vi.resetModules();
    }
  });

  it("starts not onboarded; markOnboarded persists", async () => {
    const c = coachAt({ t: T0 });
    expect(await c.isOnboarded()).toBe(false);
    await c.markOnboarded();
    expect(await c.isOnboarded()).toBe(true);
  });

  it("recovers from a persisted null state", async () => {
    const area = memoryArea({ "lasso:coach": null });
    const c = coachAt({ t: T0 }, area);

    expect(await c.isOnboarded()).toBe(false);
    expect(await c.hintsActive()).toBe(true);
    await c.markOnboarded();
    expect(await c.isOnboarded()).toBe(true);
  });

  it("hints are active inside the decay window (under 7 days and under 5 assigns)", async () => {
    const now = { t: T0 };
    const c = coachAt(now);
    expect(await c.hintsActive()).toBe(true);
    now.t = T0 + DECAY_MS - 1;
    expect(await c.hintsActive()).toBe(true);
  });

  it("hints decay after 7 days", async () => {
    const now = { t: T0 };
    const c = coachAt(now);
    await c.hintsActive(); // stamps installedAt
    now.t = T0 + DECAY_MS + 1;
    expect(await c.hintsActive()).toBe(false);
  });

  it("hints decay after 5 assigns, whichever comes first", async () => {
    const c = coachAt({ t: T0 });
    for (let i = 0; i < DECAY_ASSIGNS; i++) await c.recordAssign();
    expect(await c.hintsActive()).toBe(false);
  });

  it("one-shot tips fire exactly once (or up to a max)", async () => {
    const c = coachAt({ t: T0 });
    expect(await c.tryShowTip("first-hover")).toBe(true);
    expect(await c.tryShowTip("first-hover")).toBe(false);
    expect(await c.tryShowTip("unit", 3)).toBe(true);
    expect(await c.tryShowTip("unit", 3)).toBe(true);
    expect(await c.tryShowTip("unit", 3)).toBe(true);
    expect(await c.tryShowTip("unit", 3)).toBe(false);
  });

  it("keeps the public one-show default and rejects unbounded caller limits", async () => {
    const c = coachAt({ t: T0 });
    expect(await c.tryShowTip("unit")).toBe(true);
    expect(await c.tryShowTip("unit")).toBe(false);
    expect(await c.tryShowTip("post-assign", 4)).toBe(false);
    expect(await c.tryShowTip("forged-tip" as "unit")).toBe(false);
  });

  it("tips stop firing once the hint window has decayed", async () => {
    const now = { t: T0 };
    const c = coachAt(now);
    await c.hintsActive();
    now.t = T0 + DECAY_MS + 1;
    expect(await c.tryShowTip("first-hover")).toBe(false);
  });

  it("hintsActive tolerates a storage that drops writes (installedAt fallback)", async () => {
    // A read-only area: ensureInstalledAt's write never persists, so the later
    // read still has no installedAt and the `?? now()` fallback is exercised.
    const readonlyArea: StorageLike = {
      async get() {
        return {};
      },
      async set() {},
    };
    const c = createCoach(readonlyArea, () => T0);
    expect(await c.hintsActive()).toBe(true); // now() - now() === 0 <= DECAY_MS
  });

  it("fails closed when coach storage reads reject", async () => {
    const rejectingArea: StorageLike = {
      async get() {
        throw new Error("storage unavailable");
      },
      async set() {
        throw new Error("storage unavailable");
      },
    };
    const c = createCoach(rejectingArea, () => T0);

    await expect(c.isOnboarded()).resolves.toBe(true);
    await expect(c.hintsActive()).resolves.toBe(false);
    await expect(c.tryShowTip("first-hover")).resolves.toBe(false);
    await expect(c.markOnboarded()).resolves.toBeUndefined();
    await expect(c.recordAssign()).resolves.toBeUndefined();
    await expect(c.replayIntro()).resolves.toBeUndefined();
  });

  it("does not show a tip when its storage write rejects", async () => {
    const rejectingWriteArea: StorageLike = {
      async get() {
        return {};
      },
      async set() {
        throw new Error("storage unavailable");
      },
    };
    const c = createCoach(rejectingWriteArea, () => T0);

    await expect(c.tryShowTip("first-hover")).resolves.toBe(false);
    await expect(c.markOnboarded()).resolves.toBeUndefined();
    await expect(c.recordAssign()).resolves.toBeUndefined();
    await expect(c.replayIntro()).resolves.toBeUndefined();
  });

  it("serializes same-instance coach mutations", async () => {
    const c = coachAt({ t: T0 });

    const shown = await Promise.all([c.tryShowTip("first-hover"), c.tryShowTip("first-hover")]);
    expect(shown).toEqual([true, false]);

    await Promise.all(Array.from({ length: DECAY_ASSIGNS }, () => c.recordAssign()));
    expect(await c.hintsActive()).toBe(false);
  });

  it("replayIntro restores the welcome card and every hint for a second pass", async () => {
    const now = { t: T0 };
    const c = coachAt(now);
    await c.markOnboarded();
    await c.tryShowTip("first-hover");
    for (let i = 0; i < DECAY_ASSIGNS; i++) await c.recordAssign();
    now.t = T0 + DECAY_MS * 2;

    await c.replayIntro();
    expect(await c.isOnboarded()).toBe(false);
    expect(await c.hintsActive()).toBe(true);
    expect(await c.tryShowTip("first-hover")).toBe(true);
  });
});
