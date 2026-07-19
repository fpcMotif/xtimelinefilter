import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSettings,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type LassoSettings,
} from "@/core/settings";
import type { StorageLike } from "@/core/storage-areas";

import { createMemoryArea, installOnChanged as installOnChangedFake } from "../helpers/chrome-fake";

const KEY = "lasso:settings";
const MIRROR_OFF = { convexUrl: undefined, convexDeviceKey: undefined };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeStorage(seed?: Record<string, unknown>): StorageLike {
  return createMemoryArea(seed ?? { [KEY]: MIRROR_OFF });
}

function installOnChanged() {
  const bridge = installOnChangedFake();
  return {
    emit: (raw: unknown, area: "local" | "local" = "local", old: unknown = undefined) =>
      bridge.emit(KEY, raw, area, old),
    restore: bridge.restore,
  };
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
  it("normalizes absent nested records and explicit Mirror opt-outs", () => {
    expect(
      normalizeSettings({
        convexUrl: undefined,
        convexDeviceKey: undefined,
        surfaces: null,
        pillPosition: [],
      }),
    ).toEqual({ ...DEFAULT_SETTINGS, convexUrl: undefined, convexDeviceKey: undefined });
    expect(normalizeSettings(null)).toEqual({
      ...DEFAULT_SETTINGS,
      convexUrl: undefined,
      convexDeviceKey: undefined,
      defaultList: undefined,
      defaultListId: undefined,
    });
  });

  it("keeps a valid internal Mirror id only for a complete configuration", () => {
    expect(
      normalizeSettings({
        convexUrl: "https://mirror.convex.cloud",
        convexDeviceKey: "secret",
        mirrorConfigId: "mirror-1",
      }).mirrorConfigId,
    ).toBe("mirror-1");
    expect(
      normalizeSettings({
        convexUrl: "https://mirror.convex.cloud",
        mirrorConfigId: "stale",
      }).mirrorConfigId,
    ).toBeUndefined();
    expect(
      normalizeSettings({
        convexUrl: "https://mirror.convex.cloud",
        convexDeviceKey: "secret",
        mirrorConfigId: "",
      }).mirrorConfigId,
    ).toBeUndefined();
    expect(
      normalizeSettings({
        convexUrl: "https://mirror.convex.cloud",
        convexDeviceKey: "secret",
        mirrorConfigId: "   ",
      }).mirrorConfigId,
    ).toBeUndefined();
  });

  it("accepts an explicit undefined area as its default dependency", async () => {
    expect(await createSettings(undefined, () => "default-id").get()).toEqual({
      ...DEFAULT_SETTINGS,
      defaultList: undefined,
      defaultListId: undefined,
      mirrorConfigId: "default-id",
    });
  });

  it("returns defaults when nothing is stored (DOM backend)", async () => {
    expect(await createSettings(undefined, () => "default-id").get()).toEqual({
      ...DEFAULT_SETTINGS,
      defaultList: undefined,
      defaultListId: undefined,
      mirrorConfigId: "default-id",
    });
  });

  it("migrates a legacy sync copy into local storage once, then ignores sync", async () => {
    const local = createMemoryArea();
    const legacy = createMemoryArea({
      [KEY]: {
        backend: "graphql",
        convexUrl: "https://mirror.convex.cloud",
        convexDeviceKey: "key-1",
        mirrorConfigId: "mirror-1",
      },
    });
    const s = createSettings(local, () => "unused-id", legacy);

    expect((await s.get()).backend).toBe("graphql");
    expect(local.data[KEY]).toMatchObject({ backend: "graphql", mirrorConfigId: "mirror-1" });
    expect(legacy.data[KEY]).toBeUndefined();

    await legacy.set({ [KEY]: { backend: "dom" } });
    expect((await s.get()).backend).toBe("graphql"); // local stays authoritative
  });

  it("keeps an explicit Mirror clear as null so a default credential is not refilled", async () => {
    const area = fakeStorage({
      [KEY]: {
        convexUrl: "https://mirror.convex.cloud",
        convexDeviceKey: "key-1",
        mirrorConfigId: "mirror-1",
      },
    });
    const s = createSettings(area, () => "unused-id");
    await s.get();

    const cleared = await s.set(MIRROR_OFF);
    expect(cleared.convexUrl).toBeUndefined();
    expect(cleared.convexDeviceKey).toBeUndefined();
    expect((area as ReturnType<typeof createMemoryArea>).data[KEY]).toMatchObject({
      convexUrl: null,
      convexDeviceKey: null,
    });
    expect((await s.get()).convexUrl).toBeUndefined();
    expect((await s.get()).convexDeviceKey).toBeUndefined();
  });

  it("persists a patch and merges it over defaults", async () => {
    const s = createSettings();
    const next = await s.set({ backend: "graphql" });
    expect(next.backend).toBe("graphql");
    expect((await s.get()).backend).toBe("graphql");
    expect(await s.get()).not.toHaveProperty("hotkeySelectMode");
  });

  it("get() is a cached read: after the one-time migration probe, it hydrates storage only once", async () => {
    const area = fakeStorage();
    const getSpy = vi.spyOn(area, "get");
    const s = createSettings(area);
    await s.get();
    await s.get();
    expect(getSpy).toHaveBeenCalledTimes(2); // migration probe + the single hydrate
  });

  it("normalizes corrupted stored values and strips unknown fields", async () => {
    const s = createSettings(
      fakeStorage({
        [KEY]: {
          backend: "invalid",
          defaultList: { ownerUserId: 7, listId: "L1" },
          defaultListId: 3,
          hotkeySelectMode: "q",
          activation: "later",
          highContrast: "yes",
          convexUrl: 1,
          convexDeviceKey: {},
          surfaces: { pill: false, palette: "no" },
          pillPosition: { x: Infinity, y: "96" },
          paletteHotkey: null,
          extra: true,
        },
      }),
      () => "recovered-id",
    );

    expect(await s.get()).toEqual({
      ...DEFAULT_SETTINGS,
      defaultList: undefined,
      defaultListId: undefined,
      mirrorConfigId: "recovered-id",
      surfaces: { pill: false, palette: DEFAULT_SETTINGS.surfaces.palette },
    });
  });

  it("migrates a legacy complete Mirror config to one persisted opaque id", async () => {
    const area = fakeStorage({
      [KEY]: {
        convexUrl: "https://mirror.convex.cloud",
        convexDeviceKey: "device-key",
      },
    });
    const createId = vi.fn(() => "mirror-legacy");
    const s = createSettings(area, createId);

    expect((await s.get()).mirrorConfigId).toBe("mirror-legacy");
    expect(
      ((area as ReturnType<typeof createMemoryArea>).data[KEY] as LassoSettings).mirrorConfigId,
    ).toBe("mirror-legacy");
    expect((await s.get()).mirrorConfigId).toBe("mirror-legacy");
    expect(createId).toHaveBeenCalledOnce();
  });

  it("rotates Mirror identity only when its complete configuration changes", async () => {
    const ids = ["mirror-1", "mirror-2", "mirror-3"];
    const s = createSettings(fakeStorage(), () => ids.shift()!);

    const partial = await s.set({ convexUrl: "https://one.convex.cloud" });
    expect(partial.mirrorConfigId).toBeUndefined();
    const first = await s.set({ convexDeviceKey: "key-1" });
    expect(first.mirrorConfigId).toBe("mirror-1");
    expect((await s.set({ highContrast: true })).mirrorConfigId).toBe("mirror-1");
    expect((await s.set({ convexUrl: "https://two.convex.cloud" })).mirrorConfigId).toBe(
      "mirror-2",
    );
    expect((await s.set({ convexDeviceKey: "key-2" })).mirrorConfigId).toBe("mirror-3");
    expect((await s.set({ convexDeviceKey: undefined })).mirrorConfigId).toBeUndefined();
  });

  it("keeps valid stored strings, nested values, and finite positions", async () => {
    const s = createSettings(
      fakeStorage({
        [KEY]: {
          backend: "graphql",
          defaultList: { ownerUserId: "42", listId: "L1" },
          defaultListId: "legacy-L1",
          // Legacy shortcut configuration is no longer part of the public model.
          hotkeySelectMode: "q",
          activation: "on-demand",
          highContrast: true,
          convexUrl: "https://mirror.example",
          convexDeviceKey: "device-key",
          mirrorConfigId: "mirror-1",
          surfaces: { pill: false, palette: true },
          pillPosition: { x: -4, y: 0 },
          paletteHotkey: "alt+p",
        },
      }),
    );

    expect(await s.get()).toEqual({
      backend: "graphql",
      defaultList: { ownerUserId: "42", listId: "L1" },
      defaultListId: "legacy-L1",
      activation: "on-demand",
      highContrast: true,
      convexUrl: "https://mirror.example",
      convexDeviceKey: "device-key",
      mirrorConfigId: "mirror-1",
      surfaces: { pill: false, palette: true },
      pillPosition: { x: -4, y: 0 },
      paletteHotkey: "alt+p",
    });
    expect(await s.get()).not.toHaveProperty("hotkeySelectMode");
  });

  it("normalizes corrupt external cache before callbacks, reads, and writes", async () => {
    const bridge = installOnChanged();
    try {
      const area = createMemoryArea({ [KEY]: MIRROR_OFF });
      const s = createSettings(area);
      await s.get(); // freeze the generic store cache before corrupting it externally
      const cb = vi.fn();
      s.subscribe(cb);
      bridge.emit(
        {
          backend: "not-a-backend",
          surfaces: { pill: "no" },
          extra: true,
          ...MIRROR_OFF,
        },
        "local",
        { ...DEFAULT_SETTINGS, ...MIRROR_OFF },
      );

      expect(cb).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, ...MIRROR_OFF });
      expect(await s.get()).toEqual({ ...DEFAULT_SETTINGS, ...MIRROR_OFF });
      await s.set({ highContrast: true });
      expect(area.data[KEY] as LassoSettings).toEqual({
        ...DEFAULT_SETTINGS,
        ...MIRROR_OFF,
        highContrast: true,
      });
    } finally {
      bridge.restore();
    }
  });

  it("set() rejects when storage rejects — the settings face is not fail-soft (ADR-0009)", async () => {
    const area: StorageLike = {
      get: async () => ({ [KEY]: MIRROR_OFF }),
      set: () => Promise.reject(new Error("boom")),
    };
    const s = createSettings(area);
    await expect(s.set({ backend: "dom" })).rejects.toThrow("boom");
  });

  it("returns and notifies external Q when stale local P settles after Q", async () => {
    const bridge = installOnChanged();
    const settled = deferred<void>();
    const area: StorageLike = {
      get: async () => ({ [KEY]: MIRROR_OFF }),
      set: vi.fn(() => settled.promise),
    };
    try {
      const s = createSettings(area);
      await s.get();
      const seen: LassoSettings[] = [];
      s.subscribe((snapshot) => seen.push(snapshot));

      const p = s.set({ backend: "dom" });
      await vi.waitFor(() => expect(area.set).toHaveBeenCalledTimes(1));
      const q = { ...DEFAULT_SETTINGS, ...MIRROR_OFF, backend: "graphql" as const };
      bridge.emit(q, "local", { ...DEFAULT_SETTINGS, ...MIRROR_OFF });
      settled.resolve();

      await expect(p).resolves.toEqual(q);
      expect(seen).toEqual([q]);
      expect(await s.get()).toEqual(q);
    } finally {
      bridge.restore();
    }
  });

  it("lets queued P2 become authority after external Q, then returns P2", async () => {
    const bridge = installOnChanged();
    const first = deferred<void>();
    const second = deferred<void>();
    let calls = 0;
    const area: StorageLike = {
      get: async () => ({ [KEY]: MIRROR_OFF }),
      set: vi.fn(() => (++calls === 1 ? first.promise : second.promise)),
    };
    try {
      const s = createSettings(area);
      await s.get();
      const p1 = s.set({ highContrast: true });
      const p2 = s.set({ backend: "dom" });
      await vi.waitFor(() => expect(area.set).toHaveBeenCalledTimes(1));

      const p1Value = { ...DEFAULT_SETTINGS, ...MIRROR_OFF, highContrast: true };
      const q = { ...DEFAULT_SETTINGS, ...MIRROR_OFF, backend: "graphql" as const };
      bridge.emit(q, "local", p1Value);
      first.resolve();
      await vi.waitFor(() => expect(area.set).toHaveBeenCalledTimes(2));
      second.resolve();

      const p2Value = { ...p1Value, backend: "dom" as const };
      await expect(p1).resolves.toEqual(q);
      await expect(p2).resolves.toEqual(p2Value);
      expect(await s.get()).toEqual(p2Value);
    } finally {
      bridge.restore();
    }
  });

  it("a rejected set() leaves no trace: get() returns the pre-write value and a later set() cannot re-persist the rejected patch", async () => {
    // set() merges each patch over the cached current() — so a failed write that
    // poisoned the cache would leak its values into the NEXT set()'s storage write.
    let fail = true;
    const written: Record<string, unknown>[] = [];
    const area: StorageLike = {
      get: async () => ({ [KEY]: MIRROR_OFF }),
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
    await s.set({ defaultList: { ownerUserId: "100", listId: "L1" } });
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ defaultList: { ownerUserId: "100", listId: "L1" } }),
    );
    off();
    await s.set({ defaultList: { ownerUserId: "100", listId: "L2" } });
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
      const s = createSettings(fakeStorage());
      const cb = vi.fn();
      s.subscribe(cb);
      bridge.emit({ backend: "graphql", ...MIRROR_OFF });
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ ...DEFAULT_SETTINGS, ...MIRROR_OFF, backend: "graphql" }),
      );
    });

    it("merges a missing (undefined) external value over defaults", () => {
      bridge = installOnChanged();
      const s = createSettings(fakeStorage(), () => "default-id");
      const cb = vi.fn();
      s.subscribe(cb);
      bridge.emit({ backend: "graphql", ...MIRROR_OFF });
      cb.mockClear();
      bridge.emit(undefined, "local", { backend: "graphql", ...MIRROR_OFF });
      expect(cb).toHaveBeenCalledWith({
        ...DEFAULT_SETTINGS,
        defaultList: undefined,
        defaultListId: undefined,
        mirrorConfigId: "default-id",
      });
    });

    it("get() reflects an external onChanged from the cache (the deliberate cached-read change)", async () => {
      bridge = installOnChanged();
      const s = createSettings();
      const current = await s.get(); // hydrate
      bridge.emit({ backend: "graphql" }, "local", current); // another context writes (not into our area mock)
      expect((await s.get()).backend).toBe("graphql"); // served from the live cache, not a re-read
    });

    it("repairs an external credential change that reuses the prior Mirror id", async () => {
      bridge = installOnChanged();
      const a = normalizeSettings({
        convexUrl: "https://a.convex.cloud",
        convexDeviceKey: "key-a",
        mirrorConfigId: "mirror-a",
      });
      const area = fakeStorage({ [KEY]: a });
      const set = vi.spyOn(area, "set");
      const createId = vi.fn(() => "mirror-b");
      const s = createSettings(area, createId);
      await s.get();
      const cb = vi.fn();
      s.subscribe(cb);

      const staleB = { ...a, convexUrl: "https://b.convex.cloud" };
      bridge.emit(staleB, "local", a);

      await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
      expect(await s.get()).toEqual({ ...staleB, mirrorConfigId: "mirror-b" });
      expect(cb).toHaveBeenLastCalledWith({ ...staleB, mirrorConfigId: "mirror-b" });
      expect(createId).toHaveBeenCalledOnce();
    });

    it("does not let a queued stale repair overwrite newer external settings", async () => {
      bridge = installOnChanged();
      const a = normalizeSettings({
        convexUrl: "https://a.convex.cloud",
        convexDeviceKey: "key-a",
        mirrorConfigId: "mirror-a",
      });
      const firstSet = deferred<void>();
      const set = vi.fn(() => firstSet.promise);
      const area: StorageLike = {
        get: async () => ({ [KEY]: a }),
        set,
      };
      const createId = vi.fn(() => "repair-b");
      const s = createSettings(area, createId);
      await s.get();

      const localValue = { ...a, highContrast: true };
      const local = s.set({ highContrast: true });
      await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
      const staleB = { ...localValue, convexUrl: "https://b.convex.cloud" };
      bridge.emit(staleB, "local", localValue);
      const freshC = {
        ...staleB,
        convexUrl: "https://c.convex.cloud",
        mirrorConfigId: "mirror-c",
      };
      bridge.emit(freshC, "local", staleB);
      firstSet.resolve();

      await expect(local).resolves.toEqual(freshC);
      await Promise.resolve();
      await Promise.resolve();
      expect(set).toHaveBeenCalledTimes(1);
      expect(await s.get()).toEqual(freshC);
      expect(createId).toHaveBeenCalledOnce();
    });

    it("keeps a failed stale-id repair quarantined until get can persist a fresh id", async () => {
      bridge = installOnChanged();
      const a = normalizeSettings({
        convexUrl: "https://a.convex.cloud",
        convexDeviceKey: "key-a",
        mirrorConfigId: "mirror-a",
      });
      const area = fakeStorage({ [KEY]: a });
      const set = vi.spyOn(area, "set").mockRejectedValueOnce(new Error("sync unavailable"));
      const ids = ["repair-b", "repair-b-retry"];
      const s = createSettings(area, () => ids.shift()!);
      await s.get();
      const cb = vi.fn();
      s.subscribe(cb);

      const staleB = { ...a, convexUrl: "https://b.convex.cloud" };
      bridge.emit(staleB, "local", a);
      await vi.waitFor(() =>
        expect(cb).toHaveBeenLastCalledWith({ ...staleB, mirrorConfigId: undefined }),
      );

      expect(await s.get()).toEqual({ ...staleB, mirrorConfigId: "repair-b-retry" });
      expect(set).toHaveBeenCalledTimes(2);
    });

    it("retries quarantine instead of exposing a stale id on an unrelated external edit", async () => {
      bridge = installOnChanged();
      const a = normalizeSettings({
        convexUrl: "https://a.convex.cloud",
        convexDeviceKey: "key-a",
        mirrorConfigId: "mirror-a",
      });
      const area = fakeStorage({ [KEY]: a });
      const set = vi.spyOn(area, "set").mockRejectedValueOnce(new Error("sync unavailable"));
      const ids = ["repair-b", "repair-b-external"];
      const s = createSettings(area, () => ids.shift()!);
      await s.get();
      const cb = vi.fn();
      s.subscribe(cb);

      const staleB = { ...a, convexUrl: "https://b.convex.cloud" };
      bridge.emit(staleB, "local", a);
      await vi.waitFor(() =>
        expect(cb).toHaveBeenLastCalledWith({ ...staleB, mirrorConfigId: undefined }),
      );

      const unrelated = { ...staleB, highContrast: true };
      bridge.emit(unrelated, "local", staleB);
      await vi.waitFor(() =>
        expect(cb).toHaveBeenLastCalledWith({
          ...unrelated,
          mirrorConfigId: "repair-b-external",
        }),
      );
      expect(
        cb.mock.calls.some(
          ([snapshot]) =>
            snapshot.convexUrl === "https://b.convex.cloud" &&
            snapshot.mirrorConfigId === "mirror-a",
        ),
      ).toBe(false);
      expect(await s.get()).toEqual({ ...unrelated, mirrorConfigId: "repair-b-external" });
      expect(set).toHaveBeenCalledTimes(2);
    });

    it("repairs and persists an external complete Mirror config with no id", async () => {
      bridge = installOnChanged();
      const a = normalizeSettings({
        convexUrl: "https://a.convex.cloud",
        convexDeviceKey: "key-a",
        mirrorConfigId: "mirror-a",
      });
      const area = fakeStorage({ [KEY]: a });
      const set = vi.spyOn(area, "set");
      const createId = vi.fn(() => "mirror-b");
      const s = createSettings(area, createId);
      await s.get();

      const untaggedB = {
        ...a,
        convexUrl: "https://b.convex.cloud",
        mirrorConfigId: undefined,
      };
      bridge.emit(untaggedB, "local", a);

      await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
      expect(await s.get()).toEqual({ ...untaggedB, mirrorConfigId: "mirror-b" });
      expect(createId).toHaveBeenCalledOnce();
    });

    it("accepts a fresh external Mirror id without starting a repair loop", async () => {
      bridge = installOnChanged();
      const a = normalizeSettings({
        convexUrl: "https://a.convex.cloud",
        convexDeviceKey: "key-a",
        mirrorConfigId: "mirror-a",
      });
      const area = fakeStorage({ [KEY]: a });
      const set = vi.spyOn(area, "set");
      const createId = vi.fn(() => "unexpected-repair");
      const s = createSettings(area, createId);
      await s.get();
      const cb = vi.fn();
      s.subscribe(cb);

      const freshB = {
        ...a,
        convexUrl: "https://b.convex.cloud",
        mirrorConfigId: "mirror-b",
      };
      bridge.emit(freshB, "local", a);

      expect(await s.get()).toEqual(freshB);
      expect(cb).toHaveBeenCalledWith(freshB);
      expect(set).not.toHaveBeenCalled();
      expect(createId).not.toHaveBeenCalled();
    });

    it("strips a retained Mirror id when an external writer clears a credential", async () => {
      bridge = installOnChanged();
      const a = normalizeSettings({
        convexUrl: "https://a.convex.cloud",
        convexDeviceKey: "key-a",
        mirrorConfigId: "mirror-a",
      });
      const area = fakeStorage({ [KEY]: a });
      const set = vi.spyOn(area, "set");
      const s = createSettings(area);
      await s.get();

      const staleClear = { ...a, convexDeviceKey: undefined };
      bridge.emit(staleClear, "local", a);

      await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
      expect((await s.get()).convexDeviceKey).toBeUndefined();
      expect((await s.get()).mirrorConfigId).toBeUndefined();
      expect(
        ((area as ReturnType<typeof createMemoryArea>).data[KEY] as LassoSettings).mirrorConfigId,
      ).toBeUndefined();
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
