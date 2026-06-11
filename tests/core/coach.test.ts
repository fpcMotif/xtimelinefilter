import { describe, expect, it } from "vitest";

import { createCoach, DECAY_ASSIGNS, DECAY_MS } from "@/core/coach";
import type { StorageLike } from "@/core/settings";

function memoryArea(): StorageLike {
  const store: Record<string, unknown> = {};
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

describe("createCoach", () => {
  it("starts not onboarded; markOnboarded persists", async () => {
    const c = coachAt({ t: T0 });
    expect(await c.isOnboarded()).toBe(false);
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

  it("tips stop firing once the hint window has decayed", async () => {
    const now = { t: T0 };
    const c = coachAt(now);
    await c.hintsActive();
    now.t = T0 + DECAY_MS + 1;
    expect(await c.tryShowTip("first-hover")).toBe(false);
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
