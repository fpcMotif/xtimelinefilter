import { describe, expect, it, vi } from "vitest";

import { localArea, rawLocalArea, syncArea } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";

describe("syncArea / localArea", () => {
  it("fall back to the matching chrome.storage area without runtime messaging", async () => {
    const chromeMock = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    const syncSpy = vi.spyOn(chromeMock.storage.sync, "get");
    const localSpy = vi.spyOn(chromeMock.storage.local, "get");

    await syncArea().get(STORAGE_KEYS.filter);
    expect(syncSpy).toHaveBeenCalledWith(STORAGE_KEYS.filter);

    await localArea().get(STORAGE_KEYS.coach);
    expect(localSpy).toHaveBeenCalledWith(STORAGE_KEYS.coach);
  });

  it("keeps raw storage distinct for the background owner", async () => {
    const chromeMock = (globalThis as unknown as { chrome: typeof chrome }).chrome;
    const localSpy = vi.spyOn(chromeMock.storage.local, "get");

    await rawLocalArea().get("background-private-key");

    expect(localSpy).toHaveBeenCalledWith("background-private-key");
  });
});
