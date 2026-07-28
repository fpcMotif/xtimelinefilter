import { describe, expect, it, vi } from "vitest";

import type { StorageLike } from "@/core/storage-areas";
import { clearLassoData } from "@/core/storage-clear";
import { LOCAL_STORAGE_KEYS, STORAGE_KEYS, SYNC_STORAGE_KEYS } from "@/core/storage-keys";

describe("STORAGE_KEYS", () => {
  it("keeps stable names, including the legacy GraphQL cache literal", () => {
    expect(
      Object.entries(STORAGE_KEYS)
        .filter(([name]) => name !== "graphqlOps" && name !== "graphqlCatalog")
        .every(([, key]) => key.startsWith("lasso:")),
    ).toBe(true);
    // Pins the wire-format literals — settings.ts and filter-store.ts import
    // these directly now (no more duplicated hardcoded key), so a change here
    // is a real storage-format change, not just an internal rename.
    expect(STORAGE_KEYS.settings).toBe("lasso:settings");
    expect(STORAGE_KEYS.filter).toBe("lasso:filter");
    expect(STORAGE_KEYS.mirrorStatus).toBe("lasso:mirror-status");
    expect(STORAGE_KEYS.graphqlOps).toBe("lasso.graphqlOps.v1");
    expect(STORAGE_KEYS.graphqlCatalog).toBe("lasso.graphqlCatalog.v2");
    expect(STORAGE_KEYS.destinationSecrets).toBe("lasso:destination-secrets");
  });

  it("sweeps the reserved Destination-secrets key on clear", async () => {
    // Registered while still empty so the Destination ticket cannot introduce a
    // key that escapes Clear until somebody remembers to list it. Asserted
    // against the key itself, not against LOCAL_STORAGE_KEYS, which would be
    // self-referential.
    const local: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };
    const sync: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };
    await clearLassoData(local, sync);
    expect(vi.mocked(local.remove!).mock.calls[0]?.[0]).toContain("lasso:destination-secrets");
  });
});

describe("clearLassoData", () => {
  it("uses area.remove for local and sync when available", async () => {
    const local: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };
    const sync: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };
    await clearLassoData(local, sync);
    expect(local.remove).toHaveBeenCalledWith(LOCAL_STORAGE_KEYS);
    expect(sync.remove).toHaveBeenCalledWith(SYNC_STORAGE_KEYS);
    expect(local.set).not.toHaveBeenCalled();
    expect(sync.set).not.toHaveBeenCalled();
  });

  it("clears the existing GraphQL operation cache key", async () => {
    const local: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };
    const sync: StorageLike = { get: vi.fn(), set: vi.fn(), remove: vi.fn(async () => {}) };

    await clearLassoData(local, sync);

    expect(local.remove).toHaveBeenCalledWith(expect.arrayContaining([STORAGE_KEYS.graphqlOps]));
  });

  it("falls back to set(undefined) when remove is unavailable", async () => {
    const local: StorageLike = { get: vi.fn(), set: vi.fn(async () => {}) };
    const sync: StorageLike = { get: vi.fn(), set: vi.fn(async () => {}) };
    await clearLassoData(local, sync);
    expect(local.set).toHaveBeenCalledWith(
      Object.fromEntries(LOCAL_STORAGE_KEYS.map((k) => [k, undefined])),
    );
    expect(sync.set).toHaveBeenCalledWith(
      Object.fromEntries(SYNC_STORAGE_KEYS.map((k) => [k, undefined])),
    );
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
    expect(local.remove).toHaveBeenCalledWith(LOCAL_STORAGE_KEYS);
    expect(sync.remove).toHaveBeenCalledWith(SYNC_STORAGE_KEYS);
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
    expect(local.remove).toHaveBeenNthCalledWith(1, LOCAL_STORAGE_KEYS);
    expect(local.remove).toHaveBeenNthCalledWith(2, [dynamicKey]);
    expect(sync.remove).toHaveBeenCalledWith(SYNC_STORAGE_KEYS);
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
    expect(local.remove).toHaveBeenCalledWith(LOCAL_STORAGE_KEYS);
    expect(sync.remove).toHaveBeenCalledWith(SYNC_STORAGE_KEYS);
  });
});
