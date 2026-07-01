import { describe, expect, it, vi } from "vitest";

import { clearLassoData, STORAGE_KEYS } from "@/core/storage-keys";

describe("clearLassoData", () => {
  const LOCAL_KEYS = [STORAGE_KEYS.lists, STORAGE_KEYS.listUsage, STORAGE_KEYS.coach];

  it("uses remove() when available on both storages", async () => {
    const local = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
    const sync = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };

    await clearLassoData(local, sync);

    expect(local.remove).toHaveBeenCalledWith(LOCAL_KEYS);
    expect(local.set).not.toHaveBeenCalled();

    expect(sync.remove).toHaveBeenCalledWith(STORAGE_KEYS.settings);
    expect(sync.set).not.toHaveBeenCalled();
  });

  it("falls back to set() with undefined when remove() is unavailable", async () => {
    const local = { get: vi.fn(), set: vi.fn() };
    const sync = { get: vi.fn(), set: vi.fn() };

    await clearLassoData(local, sync);

    expect(local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.lists]: undefined,
      [STORAGE_KEYS.listUsage]: undefined,
      [STORAGE_KEYS.coach]: undefined,
    });

    expect(sync.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.settings]: undefined,
    });
  });
});
