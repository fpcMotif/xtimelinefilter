import { describe, expect, it } from "vitest";

import { createSettings, DEFAULT_SETTINGS } from "@/core/settings";
import type { LassoSettings, StorageLike } from "@/core/settings";

/** In-memory StorageLike mock — same pattern as the chrome.storage areas. */
function fakeStorage(seed: Record<string, unknown> = {}): StorageLike {
  const store: Record<string, unknown> = { ...seed };
  return {
    async get(keys?: string | string[] | null) {
      if (keys == null) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete store[k];
    },
  };
}

const KEY = "lasso:settings";

describe("surface preferences", () => {
  it("defaults to pill on, palette off with a hotkey and pill position", async () => {
    const s = createSettings(fakeStorage());
    const got = await s.get();

    expect(got.surfaces).toEqual({ pill: true, palette: false });
    expect(typeof got.paletteHotkey).toBe("string");
    expect(got.paletteHotkey.length).toBeGreaterThan(0);
    expect(typeof got.pillPosition.x).toBe("number");
    expect(typeof got.pillPosition.y).toBe("number");

    expect(DEFAULT_SETTINGS.surfaces).toEqual({ pill: true, palette: false });
  });

  it("round-trips surfaces.palette=true and pillPosition over defaults", async () => {
    const s = createSettings(fakeStorage());
    await s.set({
      surfaces: { pill: true, palette: true },
      pillPosition: { x: 40, y: 120 },
    });

    const got = await s.get();
    expect(got.surfaces).toEqual({ pill: true, palette: true });
    expect(got.pillPosition).toEqual({ x: 40, y: 120 });
    // Untouched fields stay at their defaults.
    expect(got.paletteHotkey).toBe(DEFAULT_SETTINGS.paletteHotkey);
  });

  it("yields surface defaults when a stored object lacks the new keys (migration)", async () => {
    const legacy: Partial<LassoSettings> & { hotkeySelectMode?: string } = {
      backend: "dom",
      hotkeySelectMode: "s",
      activation: "auto",
      highContrast: false,
    };
    const s = createSettings(fakeStorage({ [KEY]: legacy }));

    const got = await s.get();
    expect(got.backend).toBe("dom");
    expect(got.surfaces).toEqual({ pill: true, palette: false });
    expect(got.pillPosition).toEqual(DEFAULT_SETTINGS.pillPosition);
    expect(got.paletteHotkey).toBe(DEFAULT_SETTINGS.paletteHotkey);
    expect(got).not.toHaveProperty("hotkeySelectMode");
  });
});
