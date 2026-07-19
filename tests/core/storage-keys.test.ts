import { describe, expect, it, vi } from "vitest";

import type { StorageLike } from "@/core/storage-areas";
import { clearLassoData, STORAGE_KEYS } from "@/core/storage-keys";

const LOCAL_KEYS = [
  STORAGE_KEYS.lists,
  STORAGE_KEYS.listUsage,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.coach,
  STORAGE_KEYS.mirrorStatus,
];
const SYNC_KEYS = [STORAGE_KEYS.filter, STORAGE_KEYS.settings];

describe("STORAGE_KEYS", () => {
  it("namespaces every key under lasso:", () => {
    expect(Object.values(STORAGE_KEYS).every((k) => k.startsWith("lasso:"))).toBe(true);
    // Pins the wire-format literals — settings.ts and filter-store.ts import
    // these directly now (no more duplicated hardcoded key), so a change here
    // is a real storage-format change, not just an internal rename.
    expect(STORAGE_KEYS.settings).toBe("lasso:settings");
    expect(STORAGE_KEYS.filter).toBe("lasso:filter");
    expect(STORAGE_KEYS.mirrorStatus).toBe("lasso:mirror-status");
  });
});

describe("clearLassoData", () => {
  it("uses area.remove for local and sync when available", async () => {
    const local: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };
    const sync: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };
    await clearLassoData(local, sync);
    expect(local.remove).toHaveBeenCalledWith(LOCAL_KEYS);
    expect(sync.remove).toHaveBeenCalledWith(SYNC_KEYS);
    expect(local.set).not.toHaveBeenCalled();
    expect(sync.set).not.toHaveBeenCalled();
  });

  it("falls back to set(undefined) when remove is unavailable", async () => {
    const local: StorageLike = { get: vi.fn(), set: vi.fn(async () => {}) };
    const sync: StorageLike = { get: vi.fn(), set: vi.fn(async () => {}) };
    await clearLassoData(local, sync);
    expect(local.set).toHaveBeenCalledWith(
      Object.fromEntries(LOCAL_KEYS.map((k) => [k, undefined])),
    );
    expect(sync.set).toHaveBeenCalledWith(Object.fromEntries(SYNC_KEYS.map((k) => [k, undefined])));
  });

  it("also removes Owner-qualified cache and usage keys", async () => {
    const local: StorageLike = {
      get: vi.fn(async () => ({
        [`${STORAGE_KEYS.lists}:100`]: {},
        [`${STORAGE_KEYS.listUsage}:100`]: {},
        unrelated: true,
      })),
      set: vi.fn(),
      remove: vi.fn(async () => {}),
    };
    const sync: StorageLike = {
      get: vi.fn(async () => ({})),
      set: vi.fn(),
      remove: vi.fn(async () => {}),
    };
    await clearLassoData(local, sync);
    expect(local.remove).toHaveBeenCalledWith([
      `${STORAGE_KEYS.lists}:100`,
      `${STORAGE_KEYS.listUsage}:100`,
    ]);
  });

  it("reports local failure after dynamic-key discovery fails, but clears fixed local and sync keys", async () => {
    const local: StorageLike = {
      get: vi.fn(() => Promise.reject(new Error("read unavailable"))),
      set: vi.fn(),
      remove: vi.fn(async () => {}),
    };
    const sync: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };

    await expect(clearLassoData(local, sync)).resolves.toEqual({
      localCleared: false,
      syncCleared: true,
    });
    expect(local.remove).toHaveBeenCalledWith(LOCAL_KEYS);
    expect(sync.remove).toHaveBeenCalledWith(SYNC_KEYS);
  });

  it("reports local failure when removing discovered Owner-qualified keys fails", async () => {
    const dynamicKey = `${STORAGE_KEYS.lists}:100`;
    const local: StorageLike = {
      get: vi.fn(async () => ({ [dynamicKey]: {} })),
      set: vi.fn(),
      remove: vi
        .fn<(keys: string | string[]) => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("dynamic remove unavailable")),
    };
    const sync: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };

    await expect(clearLassoData(local, sync)).resolves.toEqual({
      localCleared: false,
      syncCleared: true,
    });
    expect(local.remove).toHaveBeenNthCalledWith(1, LOCAL_KEYS);
    expect(local.remove).toHaveBeenNthCalledWith(2, [dynamicKey]);
    expect(sync.remove).toHaveBeenCalledWith(SYNC_KEYS);
  });

  it("attempts fixed local and sync clears independently and reports their failures", async () => {
    const local: StorageLike = {
      get: vi.fn(async () => ({})),
      set: vi.fn(),
      remove: vi.fn(() => Promise.reject(new Error("local unavailable"))),
    };
    const sync: StorageLike = {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(async () => {}),
    };

    await expect(clearLassoData(local, sync)).resolves.toEqual({
      localCleared: false,
      syncCleared: true,
    });
    expect(local.remove).toHaveBeenCalledWith(LOCAL_KEYS);
    expect(sync.remove).toHaveBeenCalledWith(SYNC_KEYS);
  });
});
