import { describe, expect, it, vi } from "vitest";

import { createSettings, DEFAULT_SETTINGS } from "@/core/settings";

describe("createSettings", () => {
  it("returns defaults when nothing is stored", async () => {
    expect(await createSettings().get()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists a patch and merges it over defaults", async () => {
    const s = createSettings();
    const next = await s.set({ backend: "graphql" });
    expect(next.backend).toBe("graphql");
    expect((await s.get()).backend).toBe("graphql");
    expect((await s.get()).hotkeySelectMode).toBe("s");
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

  it("migrates a synced settings blob to local on first read, then removes it from sync", async () => {
    await chrome.storage.sync.set({
      "lasso:settings": { backend: "graphql", defaultListId: "L1" },
    });
    const s = createSettings();
    expect((await s.get()).backend).toBe("graphql");
    expect((await chrome.storage.local.get("lasso:settings"))["lasso:settings"]).toMatchObject({
      backend: "graphql",
      defaultListId: "L1",
    });
    expect((await chrome.storage.sync.get("lasso:settings"))["lasso:settings"]).toBeUndefined();
  });

  it("prefers an existing local value over a stale synced one", async () => {
    await chrome.storage.local.set({ "lasso:settings": { backend: "dom" } });
    await chrome.storage.sync.set({ "lasso:settings": { backend: "graphql" } });
    const s = createSettings();
    expect((await s.get()).backend).toBe("dom");
  });

  it("a first set() does not lose a not-yet-migrated synced value", async () => {
    await chrome.storage.sync.set({ "lasso:settings": { defaultListId: "L9" } });
    const s = createSettings();
    await s.set({ backend: "graphql" });
    expect((await s.get()).defaultListId).toBe("L9");
  });
});
