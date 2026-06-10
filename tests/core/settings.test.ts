import { describe, expect, it, vi } from "vitest";

import { createSettings, DEFAULT_SETTINGS } from "@/core/settings";

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
});
