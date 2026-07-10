import { describe, expect, it, vi } from "vitest";

import { createMembershipStore } from "@/core/membership-store/factory";
import { NullMembershipStore } from "@/core/membership-store/null";

describe("createMembershipStore", () => {
  it("returns the Null store and never builds Convex when unconfigured", () => {
    const buildConvex = vi.fn();
    const store = createMembershipStore({}, buildConvex);
    expect(store).toBeInstanceOf(NullMembershipStore);
    expect(buildConvex).not.toHaveBeenCalled();
  });

  it("builds Convex once with the config when url + device key are set", () => {
    const built = new NullMembershipStore();
    const buildConvex = vi.fn(() => built);
    const store = createMembershipStore(
      { convexUrl: "https://x.convex.cloud", convexDeviceKey: "k" },
      buildConvex,
    );
    expect(store).toBe(built);
    expect(buildConvex).toHaveBeenCalledTimes(1);
    expect(buildConvex).toHaveBeenCalledWith({ url: "https://x.convex.cloud", deviceKey: "k" });
  });

  it("falls back to Null when only one of url / device key is present", () => {
    const buildConvex = vi.fn();
    expect(createMembershipStore({ convexUrl: "u" }, buildConvex)).toBeInstanceOf(
      NullMembershipStore,
    );
    expect(createMembershipStore({ convexDeviceKey: "k" }, buildConvex)).toBeInstanceOf(
      NullMembershipStore,
    );
    expect(buildConvex).not.toHaveBeenCalled();
  });

  it("degrades to Null (never throws) when buildConvex throws — e.g. a malformed URL (H1, ADR-0009)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const buildConvex = vi.fn(() => {
      throw new Error("Invalid deployment address: convex.cloud");
    });
    const store = createMembershipStore(
      { convexUrl: "convex.cloud", convexDeviceKey: "k" },
      buildConvex,
    );
    expect(store).toBeInstanceOf(NullMembershipStore); // boot never aborts
    expect(buildConvex).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[Lasso] Mirror disabled — Convex client construction failed",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
