import { describe, expect, it, vi } from "vitest";

import { createMembershipStore } from "@/core/membership-store/factory";
import { NullMembershipStore } from "@/core/membership-store/null";

describe("createMembershipStore", () => {
  it("returns the Null store and never loads Convex when unconfigured", async () => {
    const loadConvex = vi.fn();
    const store = await createMembershipStore({}, loadConvex);
    expect(store).toBeInstanceOf(NullMembershipStore);
    // Not merely "not built" — never even fetched: the chunk stays off the wire.
    expect(loadConvex).not.toHaveBeenCalled();
  });

  it("builds Convex once with the config when url + device key are set", async () => {
    const built = new NullMembershipStore();
    const buildConvex = vi.fn(() => built);
    const loadConvex = vi.fn(async () => buildConvex);
    const store = await createMembershipStore(
      { convexUrl: "https://x.convex.cloud", convexDeviceKey: "k" },
      loadConvex,
    );
    expect(store).toBe(built);
    expect(loadConvex).toHaveBeenCalledTimes(1);
    expect(buildConvex).toHaveBeenCalledTimes(1);
    expect(buildConvex).toHaveBeenCalledWith({ url: "https://x.convex.cloud", deviceKey: "k" });
  });

  it("falls back to Null when only one of url / device key is present", async () => {
    const loadConvex = vi.fn();
    await expect(createMembershipStore({ convexUrl: "u" }, loadConvex)).resolves.toBeInstanceOf(
      NullMembershipStore,
    );
    await expect(
      createMembershipStore({ convexDeviceKey: "k" }, loadConvex),
    ).resolves.toBeInstanceOf(NullMembershipStore);
    expect(loadConvex).not.toHaveBeenCalled();
  });

  it("degrades to Null (never throws) when buildConvex throws — e.g. a malformed URL (H1, ADR-0009)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const buildConvex = vi.fn(() => {
      throw new Error("Invalid deployment address: convex.cloud");
    });
    const store = await createMembershipStore(
      { convexUrl: "convex.cloud", convexDeviceKey: "k" },
      async () => buildConvex,
    );
    expect(store).toBeInstanceOf(NullMembershipStore); // boot never aborts
    expect(buildConvex).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[Lasso] Mirror disabled — Convex client unavailable",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("degrades to Null when the Convex chunk itself fails to load (ADR-0009)", async () => {
    // The dynamic import() can reject where a static one couldn't: the chunk may be
    // missing from web_accessible_resources, or blocked. Boot must survive it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loadConvex = vi.fn(async () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const store = await createMembershipStore(
      { convexUrl: "https://x.convex.cloud", convexDeviceKey: "k" },
      loadConvex,
    );
    expect(store).toBeInstanceOf(NullMembershipStore);
    expect(warn).toHaveBeenCalledWith(
      "[Lasso] Mirror disabled — Convex client unavailable",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
