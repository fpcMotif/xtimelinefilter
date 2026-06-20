import { afterEach, describe, expect, it, vi } from "vitest";

import { createSettings, DEFAULT_SETTINGS } from "@/core/settings";
import type { StorageLike } from "@/core/settings";

const KEY = "lasso:settings";

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

function installOnChanged() {
  const chromeMock = globalThis as unknown as { chrome: { storage: Record<string, unknown> } };
  const prev = chromeMock.chrome.storage.onChanged;
  const listeners: Listener[] = [];
  chromeMock.chrome.storage.onChanged = {
    addListener: (l: Listener) => listeners.push(l),
    removeListener: () => {},
  };
  const emit = (raw: unknown) => {
    for (const l of listeners) l({ [KEY]: { newValue: raw } }, "sync");
  };
  const restore = () => {
    chromeMock.chrome.storage.onChanged = prev;
  };
  return { emit, restore };
}

describe("DEFAULT_SETTINGS Mirror config from build env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falls back to undefined when the Convex env vars are empty (the falsy `||` branch)", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    vi.stubEnv("VITE_LASSO_DEVICE_KEY", "");
    vi.resetModules();
    const fresh = await import("@/core/settings");
    expect(fresh.DEFAULT_SETTINGS.convexUrl).toBeUndefined();
    expect(fresh.DEFAULT_SETTINGS.convexDeviceKey).toBeUndefined();
  });

  it("adopts the build-time Convex env when present (the truthy `||` branch)", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://silent-crab-355.convex.cloud");
    vi.stubEnv("VITE_LASSO_DEVICE_KEY", "device-123");
    vi.resetModules();
    const fresh = await import("@/core/settings");
    expect(fresh.DEFAULT_SETTINGS.convexUrl).toBe("https://silent-crab-355.convex.cloud");
    expect(fresh.DEFAULT_SETTINGS.convexDeviceKey).toBe("device-123");
  });
});

describe("createSettings", () => {
  it("returns defaults when nothing is stored (DOM backend)", async () => {
    expect(await createSettings().get()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists a patch and merges it over defaults", async () => {
    const s = createSettings();
    const next = await s.set({ backend: "graphql" });
    expect(next.backend).toBe("graphql");
    expect((await s.get()).backend).toBe("graphql");
    expect((await s.get()).hotkeySelectMode).toBe("s");
  });

  it("get() is a cached read: hydrates storage only once across calls", async () => {
    const area = fakeStorage();
    const getSpy = vi.spyOn(area, "get");
    const s = createSettings(area);
    await s.get();
    await s.get();
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("set() rejects when storage rejects — the settings face is not fail-soft (ADR-0009)", async () => {
    const area: StorageLike = {
      get: async () => ({}),
      set: () => Promise.reject(new Error("boom")),
    };
    const s = createSettings(area);
    await expect(s.set({ backend: "dom" })).rejects.toThrow("boom");
  });

  it("notifies subscribers on set and stops after unsubscribe", async () => {
    const s = createSettings();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    await s.set({ defaultListId: "L1" });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ defaultListId: "L1" }));
    off();
    await s.set({ defaultListId: "L2" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  describe("cross-context onChanged bridge", () => {
    let bridge: ReturnType<typeof installOnChanged> | undefined;
    afterEach(() => {
      bridge?.restore();
      bridge = undefined;
    });

    it("notifies subscribers when another context writes settings", () => {
      bridge = installOnChanged();
      const s = createSettings();
      const cb = vi.fn();
      s.subscribe(cb);
      bridge.emit({ backend: "graphql" });
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ ...DEFAULT_SETTINGS, backend: "graphql" }),
      );
    });

    it("merges a missing (undefined) external value over defaults", () => {
      bridge = installOnChanged();
      const s = createSettings();
      const cb = vi.fn();
      s.subscribe(cb);
      bridge.emit(undefined);
      expect(cb).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    });

    it("get() reflects an external onChanged from the cache (the deliberate cached-read change)", async () => {
      bridge = installOnChanged();
      const s = createSettings();
      await s.get(); // hydrate
      bridge.emit({ backend: "graphql" }); // another context writes (not into our area mock)
      expect((await s.get()).backend).toBe("graphql"); // served from the live cache, not a re-read
    });

    it("drops the echo of our own write (no redundant notify)", async () => {
      bridge = installOnChanged();
      const s = createSettings();
      const next = await s.set({ backend: "dom" });
      const cb = vi.fn();
      s.subscribe(cb);
      bridge.emit(next); // identical to what we just wrote → ignored
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
