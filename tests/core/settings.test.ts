import { afterEach, describe, expect, it, vi } from "vitest";

import { createSettings, DEFAULT_SETTINGS } from "@/core/settings";
import type { StorageLike } from "@/core/settings";

import { createMemoryArea, installOnChanged as installOnChangedFake } from "../helpers/chrome-fake";

const KEY = "lasso:settings";

function fakeStorage(seed: Record<string, unknown> = {}): StorageLike {
  return createMemoryArea(seed);
}

function installOnChanged() {
  const bridge = installOnChangedFake();
  return { emit: (raw: unknown) => bridge.emit(KEY, raw), restore: bridge.restore };
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

  it("never inlines the Convex credential in production builds (M1 — the dev-gate falsy branch)", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CONVEX_URL", "https://silent-crab-355.convex.cloud");
    vi.stubEnv("VITE_LASSO_DEVICE_KEY", "device-123");
    vi.resetModules();
    const fresh = await import("@/core/settings");
    expect(fresh.DEFAULT_SETTINGS.convexUrl).toBeUndefined();
    expect(fresh.DEFAULT_SETTINGS.convexDeviceKey).toBeUndefined();
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

  it("a rejected set() leaves no trace: get() returns the pre-write value and a later set() cannot re-persist the rejected patch", async () => {
    // set() merges each patch over the cached current() — so a failed write that
    // poisoned the cache would leak its values into the NEXT set()'s storage write.
    let fail = true;
    const written: Record<string, unknown>[] = [];
    const area: StorageLike = {
      get: async () => ({}),
      set: async (items) => {
        if (fail) throw new Error("boom");
        written.push(items);
      },
    };
    const s = createSettings(area);
    await expect(s.set({ backend: "dom" })).rejects.toThrow("boom");
    expect((await s.get()).backend).toBe(DEFAULT_SETTINGS.backend); // failure never reads as success

    fail = false; // storage recovers; an unrelated save must not smuggle `backend: "dom"` along
    await s.set({ highContrast: true });
    const persisted = written[0]?.[KEY] as { backend: string } | undefined;
    expect(persisted?.backend).toBe(DEFAULT_SETTINGS.backend);
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
