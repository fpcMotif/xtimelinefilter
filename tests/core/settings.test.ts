import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSettings,
  DEFAULT_SETTINGS,
  encodeSettings,
  MAX_CONVEX_DEVICE_KEY_LENGTH,
  MAX_CONVEX_URL_LENGTH,
  MAX_MIRROR_CONFIG_ID_LENGTH,
  MAX_PALETTE_HOTKEY_LENGTH,
  MAX_SETTINGS_ID_LENGTH,
  mergeSettings,
  normalizeSettings,
  transitionSettings,
  type LassoSettings,
} from "@/core/settings";
import type { StorageLike } from "@/core/storage-areas";

import { createMemoryArea, installOnChanged } from "../helpers/chrome-fake";

const KEY = "lasso:settings";
const OFF = { convexUrl: undefined, convexDeviceKey: undefined };

function complete(id = "mirror-a"): LassoSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...OFF,
    convexUrl: "https://one.convex.cloud",
    convexDeviceKey: "key-one",
    mirrorConfigId: id,
  };
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

describe("settings domain", () => {
  it("reads development credentials from the build environment", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
    vi.stubEnv("VITE_LASSO_DEVICE_KEY", "test-key");
    vi.resetModules();
    const reloaded = await import("@/core/settings-domain");

    expect(reloaded.DEFAULT_SETTINGS).toMatchObject({
      convexUrl: "https://test.convex.cloud",
      convexDeviceKey: "test-key",
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("normalizes only known fields and keeps explicit credential clears", () => {
    expect(
      normalizeSettings({
        backend: "invalid",
        convexUrl: null,
        convexDeviceKey: null,
        surfaces: { pill: false, extra: true },
        pillPosition: { x: Infinity },
        extra: true,
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      ...OFF,
      defaultList: undefined,
      defaultListId: undefined,
      surfaces: { pill: false, palette: DEFAULT_SETTINGS.surfaces.palette },
    });
  });

  it("repairs oversized persisted strings instead of rewriting them", () => {
    expect(
      normalizeSettings({
        defaultList: { ownerUserId: "x".repeat(MAX_SETTINGS_ID_LENGTH + 1), listId: "1" },
        defaultListId: "x".repeat(MAX_SETTINGS_ID_LENGTH + 1),
        convexUrl: "x".repeat(MAX_CONVEX_URL_LENGTH + 1),
        convexDeviceKey: "x".repeat(MAX_CONVEX_DEVICE_KEY_LENGTH + 1),
        mirrorConfigId: "x".repeat(MAX_MIRROR_CONFIG_ID_LENGTH + 1),
        paletteHotkey: "x".repeat(MAX_PALETTE_HOTKEY_LENGTH + 1),
        pillPosition: { x: 1e308, y: -1e308 },
      }),
    ).toMatchObject({
      defaultList: undefined,
      defaultListId: undefined,
      convexUrl: DEFAULT_SETTINGS.convexUrl,
      convexDeviceKey: DEFAULT_SETTINGS.convexDeviceKey,
      mirrorConfigId: undefined,
      paletteHotkey: DEFAULT_SETTINGS.paletteHotkey,
      pillPosition: DEFAULT_SETTINGS.pillPosition,
    });
  });

  it("normalizes absent, malformed, and valid persisted shapes", () => {
    expect(normalizeSettings(null)).toEqual({ ...DEFAULT_SETTINGS, ...OFF });
    expect(
      normalizeSettings({
        defaultList: { ownerUserId: "owner", listId: "list" },
        defaultListId: "legacy-list",
        convexUrl: "https://mirror.convex.cloud",
        convexDeviceKey: "mirror-key",
        mirrorConfigId: "mirror-id",
        surfaces: null,
        pillPosition: null,
      }),
    ).toMatchObject({
      defaultList: { ownerUserId: "owner", listId: "list" },
      defaultListId: "legacy-list",
      mirrorConfigId: "mirror-id",
      surfaces: DEFAULT_SETTINGS.surfaces,
      pillPosition: DEFAULT_SETTINGS.pillPosition,
    });
    expect(
      normalizeSettings({ defaultList: { ownerUserId: "owner" } }).defaultList,
    ).toBeUndefined();
  });

  it("merges nested patches and refuses a caller-supplied Mirror id", () => {
    const base = complete();
    const merged = mergeSettings(base, {
      surfaces: { palette: true },
      pillPosition: { x: 12 },
      ...({ mirrorConfigId: "forged" } as object),
    });

    expect(merged.surfaces).toEqual({ pill: true, palette: true });
    expect(merged.pillPosition).toEqual({ x: 12, y: 96 });
    expect(merged.mirrorConfigId).toBe("mirror-a");
  });

  it("rotates Mirror identity only for credential changes or completion", () => {
    const base = complete();
    const mint = vi.fn(() => "mirror-b");

    const unrelated = transitionSettings(base, mint, { highContrast: true });
    expect(unrelated.settings.mirrorConfigId).toBe("mirror-a");
    expect(mint).not.toHaveBeenCalled();

    const changed = transitionSettings(base, mint, { convexUrl: "https://two.convex.cloud" });
    expect(changed.settings.mirrorConfigId).toBe("mirror-b");
    expect(mint).toHaveBeenCalledOnce();

    const incomplete = { ...base, convexDeviceKey: null, mirrorConfigId: undefined };
    const completed = transitionSettings(incomplete, () => "mirror-c", {
      convexDeviceKey: "key-two",
    });
    expect(completed.settings.mirrorConfigId).toBe("mirror-c");
  });

  it("preserves null tombstones for an explicit dev-default credential clear", () => {
    const before = complete();
    const transition = transitionSettings(before, () => "unused", {
      convexUrl: undefined,
      convexDeviceKey: undefined,
    });

    expect(transition.settings).toMatchObject(OFF);
    expect(transition.settings.mirrorConfigId).toBeUndefined();
    expect(transition.stored).toMatchObject({ convexUrl: null, convexDeviceKey: null });
    expect(encodeSettings(transition.settings, transition.stored)).toMatchObject({
      convexUrl: null,
      convexDeviceKey: null,
    });
  });

  it("encodes optional fields and only keeps credential tombstones when asked", () => {
    const settings = {
      ...complete(),
      defaultList: { ownerUserId: "owner", listId: "list" },
      defaultListId: "legacy-list",
    };
    expect(encodeSettings(settings, null)).toMatchObject({
      defaultList: settings.defaultList,
      defaultListId: "legacy-list",
      convexUrl: settings.convexUrl,
      convexDeviceKey: settings.convexDeviceKey,
    });
    expect(encodeSettings({ ...DEFAULT_SETTINGS, ...OFF }, {})).not.toHaveProperty("convexUrl");
    expect(encodeSettings({ ...DEFAULT_SETTINGS, ...OFF }, {})).not.toHaveProperty(
      "convexDeviceKey",
    );
  });

  it("repairs a stale external Mirror id and rejects an empty minted id", () => {
    const before = complete("mirror-a");
    const stale = { ...before, convexUrl: "https://two.convex.cloud" };
    const repaired = transitionSettings(stale, () => "mirror-b", undefined, before);
    expect(repaired.settings.mirrorConfigId).toBe("mirror-b");

    expect(() => transitionSettings({ ...before, mirrorConfigId: undefined }, () => "")).toThrow(
      "Mirror config identity must not be empty.",
    );
    expect(transitionSettings(null, () => "unused").settings).toMatchObject({
      ...DEFAULT_SETTINGS,
      mirrorConfigId: "unused",
    });
  });
});

describe("injected settings storage", () => {
  it("uses the worker transition policy for direct test storage", async () => {
    const area = createMemoryArea({ [KEY]: complete() });
    const settings = createSettings(area, () => "mirror-b");

    await settings.set({ surfaces: { palette: true } });
    expect((await settings.get()).mirrorConfigId).toBe("mirror-a");

    await settings.set({ convexDeviceKey: "key-two" });
    expect((await settings.get()).mirrorConfigId).toBe("mirror-b");
  });

  it("keeps direct explicit clears as null in storage", async () => {
    const area = createMemoryArea({ [KEY]: complete() });
    const settings = createSettings(area, () => "unused");

    await settings.set(OFF);

    expect(area.data[KEY]).toMatchObject({ convexUrl: null, convexDeviceKey: null });
    expect(await settings.get()).toMatchObject(OFF);
  });

  it("publishes normalized external snapshots", async () => {
    const bridge = installOnChanged();
    try {
      const area = createMemoryArea({ [KEY]: { ...DEFAULT_SETTINGS, ...OFF } });
      const settings = createSettings(area, () => "unused");
      await settings.get();
      const seen = vi.fn();
      settings.subscribe(seen);

      bridge.emit(
        KEY,
        { ...DEFAULT_SETTINGS, ...OFF, backend: "graphql" },
        "local",
        area.data[KEY],
      );

      expect(seen).toHaveBeenCalledWith(
        expect.objectContaining({ backend: "graphql", ...OFF }),
        "external",
      );
    } finally {
      bridge.restore();
    }
  });

  it("avoids redundant writes, stops its watcher, and accepts canonical external state", async () => {
    const bridge = installOnChanged();
    try {
      const base = encodeSettings(
        { ...DEFAULT_SETTINGS, ...OFF },
        {
          convexUrl: null,
          convexDeviceKey: null,
        },
      );
      const area = createMemoryArea({ [KEY]: base });
      const set = vi.spyOn(area, "set");
      const settings = createSettings(area, () => "unused");
      await settings.get();
      const seen = vi.fn();
      const first = settings.subscribe(seen);
      const second = settings.subscribe(vi.fn());

      await expect(settings.set({ backend: "rest" })).resolves.toEqual({
        ...DEFAULT_SETTINGS,
        ...OFF,
      });
      expect(seen).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();

      const external = encodeSettings({ ...DEFAULT_SETTINGS, ...OFF, backend: "graphql" }, base);
      bridge.emit(KEY, external, "local", base);
      expect(seen).toHaveBeenCalledWith(
        expect.objectContaining({ backend: "graphql" }),
        "external",
      );
      expect(set).not.toHaveBeenCalled();

      first();
      second();
      second();
    } finally {
      bridge.restore();
    }
  });

  it("keeps newer external authority when a direct write races it", async () => {
    const bridge = installOnChanged();
    try {
      const base = encodeSettings(
        { ...DEFAULT_SETTINGS, ...OFF },
        {
          convexUrl: null,
          convexDeviceKey: null,
        },
      );
      const pendingSet = deferred<void>();
      const set = vi.fn(() => pendingSet.promise);
      const area: StorageLike = {
        get: async () => ({ [KEY]: base }),
        set,
      };
      const settings = createSettings(area, () => "unused");
      await settings.get();
      const seen = vi.fn();
      settings.subscribe(seen);

      const local = settings.set({ backend: "dom" });
      await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(1));
      const external = encodeSettings({ ...DEFAULT_SETTINGS, ...OFF, backend: "graphql" }, base);
      bridge.emit(KEY, external, "local", base);
      pendingSet.resolve();

      await expect(local).resolves.toMatchObject({ backend: "graphql" });
      expect(seen).toHaveBeenLastCalledWith(
        expect.objectContaining({ backend: "graphql" }),
        "external",
      );
    } finally {
      bridge.restore();
    }
  });

  it("keeps an external stale-id repair out of callers when persistence fails", async () => {
    const bridge = installOnChanged();
    try {
      const base = encodeSettings(complete(), {});
      const area: StorageLike = {
        get: async () => ({ [KEY]: base }),
        set: vi.fn(() => Promise.reject(new Error("repair unavailable"))),
      };
      const settings = createSettings(area, () => "mirror-b");
      await settings.get();
      const seen = vi.fn();
      settings.subscribe(seen);

      bridge.emit(KEY, { ...base, convexUrl: "https://two.convex.cloud" }, "local", base);

      await vi.waitFor(() => expect(area.set).toHaveBeenCalledTimes(1));
      expect(seen).toHaveBeenCalledWith(
        expect.objectContaining({ mirrorConfigId: "mirror-b" }),
        "external",
      );
    } finally {
      bridge.restore();
    }
  });

  it("rejects direct storage failures", async () => {
    const area: StorageLike = {
      get: async () => ({ [KEY]: { ...DEFAULT_SETTINGS, ...OFF } }),
      set: async () => {
        throw new Error("storage unavailable");
      },
    };
    await expect(createSettings(area).set({ backend: "dom" })).rejects.toThrow(
      "storage unavailable",
    );
  });
});

describe("worker settings client", () => {
  let previousChrome: typeof chrome;

  afterEach(() => {
    globalThis.chrome = previousChrome;
  });

  it("uses read/patch commands, encodes clears, and drops its duplicate local echo", async () => {
    previousChrome = globalThis.chrome;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
    const initial = { ...DEFAULT_SETTINGS, ...OFF };
    const changed = { ...initial, backend: "dom" as const };
    const sendMessage = vi.fn(async (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "operation" in message &&
        message.operation === "patch"
      ) {
        onMessage?.(
          {
            type: "lasso:storage-changed",
            area: "local",
            key: KEY,
            oldValue: initial,
            newValue: changed,
          },
          {
            id: "lasso-id",
            url: "chrome-extension://lasso-id/worker.js",
            origin: "chrome-extension://lasso-id",
          },
        );
        return { ok: true, settings: changed };
      }
      return { ok: true, settings: initial };
    });
    globalThis.chrome = {
      ...previousChrome,
      runtime: {
        id: "lasso-id",
        getManifest: () => ({ background: { service_worker: "worker.js" } }),
        getURL: (path: string) => `chrome-extension://lasso-id/${path}`,
        sendMessage,
        onMessage: {
          addListener: (
            listener: (message: unknown, sender: chrome.runtime.MessageSender) => void,
          ) => (onMessage = listener),
          removeListener: () => {},
        },
      },
    } as unknown as typeof chrome;

    const settings = createSettings();
    const seen = vi.fn();
    settings.subscribe(seen);
    await expect(settings.get()).resolves.toEqual(initial);
    await expect(settings.set({ backend: "dom" })).resolves.toEqual(changed);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith(changed, "local");
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "lasso:settings", operation: "read" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: "lasso:settings",
      operation: "patch",
      patch: { backend: "dom" },
    });
  });

  it("fences a stale read behind a subscribed external snapshot", async () => {
    previousChrome = globalThis.chrome;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
    let resolveRead!: (value: unknown) => void;
    const read = new Promise<unknown>((resolve) => (resolveRead = resolve));
    globalThis.chrome = {
      ...previousChrome,
      runtime: {
        id: "lasso-id",
        getManifest: () => ({ background: { service_worker: "worker.js" } }),
        getURL: (path: string) => `chrome-extension://lasso-id/${path}`,
        sendMessage: vi.fn(() => read),
        onMessage: {
          addListener: (
            listener: (message: unknown, sender: chrome.runtime.MessageSender) => void,
          ) => (onMessage = listener),
          removeListener: () => {},
        },
      },
    } as unknown as typeof chrome;
    const settings = createSettings();
    const latest = { ...DEFAULT_SETTINGS, ...OFF, backend: "graphql" as const };
    settings.subscribe(() => {});

    const pending = settings.get();
    onMessage?.(
      {
        type: "lasso:storage-changed",
        area: "local",
        key: KEY,
        oldValue: null,
        newValue: latest,
      },
      {
        id: "lasso-id",
        url: "chrome-extension://lasso-id/worker.js",
        origin: "chrome-extension://lasso-id",
      },
    );
    resolveRead({ ok: true, settings: { ...DEFAULT_SETTINGS, ...OFF } });

    await expect(pending).resolves.toEqual(latest);
  });

  it("fences a stale read behind a later local patch response", async () => {
    previousChrome = globalThis.chrome;
    let resolveRead!: (value: unknown) => void;
    const read = new Promise<unknown>((resolve) => (resolveRead = resolve));
    const initial = { ...DEFAULT_SETTINGS, ...OFF };
    const changed = { ...initial, highContrast: true };
    let calls = 0;
    globalThis.chrome = {
      ...previousChrome,
      runtime: {
        sendMessage: vi.fn(() =>
          ++calls === 1 ? read : Promise.resolve({ ok: true, settings: changed }),
        ),
        onMessage: { addListener: () => {}, removeListener: () => {} },
      },
    } as unknown as typeof chrome;
    const settings = createSettings();

    const pending = settings.get();
    await expect(settings.set({ highContrast: true })).resolves.toEqual(changed);
    resolveRead({ ok: true, settings: initial });

    await expect(pending).resolves.toEqual(changed);
  });

  it("keeps a subscribed external authority when a patch response arrives late", async () => {
    previousChrome = globalThis.chrome;
    let onMessage: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
    const patch = deferred<unknown>();
    const initial = { ...DEFAULT_SETTINGS, ...OFF };
    const external = { ...initial, backend: "graphql" as const };
    const sendMessage = vi.fn((message: { operation: "read" | "patch" }) =>
      message.operation === "read"
        ? Promise.resolve({ ok: true, settings: initial })
        : patch.promise,
    );
    globalThis.chrome = {
      ...previousChrome,
      runtime: {
        id: "lasso-id",
        getManifest: () => ({ background: { service_worker: "worker.js" } }),
        getURL: (path: string) => `chrome-extension://lasso-id/${path}`,
        sendMessage,
        onMessage: {
          addListener: (
            listener: (message: unknown, sender: chrome.runtime.MessageSender) => void,
          ) => (onMessage = listener),
          removeListener: () => {},
        },
      },
    } as unknown as typeof chrome;
    const settings = createSettings();
    settings.subscribe(() => {});
    await settings.get();

    const local = settings.set({ backend: "dom" });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    onMessage?.(
      {
        type: "lasso:storage-changed",
        area: "local",
        key: KEY,
        oldValue: initial,
        newValue: external,
      },
      {
        id: "lasso-id",
        url: "chrome-extension://lasso-id/worker.js",
        origin: "chrome-extension://lasso-id",
      },
    );
    patch.resolve({ ok: true, settings: { ...initial, backend: "dom" } });

    await expect(local).resolves.toEqual(external);
  });

  it("retries a failed worker patch and tears down the final subscription", async () => {
    previousChrome = globalThis.chrome;
    const removeListener = vi.fn();
    let calls = 0;
    globalThis.chrome = {
      ...previousChrome,
      runtime: {
        id: "lasso-id",
        getManifest: () => ({ background: { service_worker: "worker.js" } }),
        getURL: (path: string) => `chrome-extension://lasso-id/${path}`,
        sendMessage: vi.fn(() =>
          ++calls === 1
            ? Promise.reject(new Error("worker unavailable"))
            : Promise.resolve({ ok: true, settings: { ...DEFAULT_SETTINGS, ...OFF } }),
        ),
        onMessage: { addListener: () => {}, removeListener },
      },
    } as unknown as typeof chrome;
    const settings = createSettings();
    const dispose = settings.subscribe(() => {});
    const second = settings.subscribe(() => {});
    await expect(settings.set({ backend: "dom" })).rejects.toThrow("worker unavailable");
    await expect(settings.set({ backend: "rest" })).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      ...OFF,
    });
    dispose();
    second();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("uses local storage when no worker transport exists", async () => {
    previousChrome = globalThis.chrome;
    const area = createMemoryArea();
    globalThis.chrome = {
      ...previousChrome,
      runtime: {},
      storage: { local: area },
    } as unknown as typeof chrome;

    const settings = createSettings(undefined, () => "unused");
    await expect(settings.set({ backend: "dom" })).resolves.toMatchObject({ backend: "dom" });
    expect(area.data[KEY]).toMatchObject({ backend: "dom" });
  });

  it("mints a default Mirror identity only when the injected credentials become complete", async () => {
    previousChrome = globalThis.chrome;
    const area = createMemoryArea({
      [KEY]: { convexUrl: null, convexDeviceKey: null },
    });
    globalThis.chrome = { ...previousChrome, runtime: {} } as typeof chrome;

    const settings = createSettings(area);
    const next = await settings.set({
      convexUrl: "https://mirror.convex.cloud",
      convexDeviceKey: "mirror-key",
    });
    expect(next.mirrorConfigId).toEqual(expect.any(String));
  });
});
