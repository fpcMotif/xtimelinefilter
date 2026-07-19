import { describe, expect, it, vi } from "vitest";

const convex = vi.hoisted(() => ({ probe: vi.fn(async () => {}) }));

vi.mock("@/core/membership-store/convex-client", () => ({
  testConvexConnection: convex.probe,
}));

import {
  createMembershipStore,
  createMembershipStoreProbe,
  defaultMembershipStoreProbe,
} from "@/core/membership-store/factory";
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

  it("rejects when configured buildConvex throws", async () => {
    const buildConvex = vi.fn(() => {
      throw new Error("Invalid deployment address: convex.cloud");
    });
    await expect(
      createMembershipStore(
        { convexUrl: "convex.cloud", convexDeviceKey: "k" },
        async () => buildConvex,
      ),
    ).rejects.toThrow("Invalid deployment address");
    expect(buildConvex).toHaveBeenCalledTimes(1);
  });

  it("rejects when the configured Convex chunk fails to load", async () => {
    const loadConvex = vi.fn(async () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    await expect(
      createMembershipStore(
        { convexUrl: "https://x.convex.cloud", convexDeviceKey: "k" },
        loadConvex,
      ),
    ).rejects.toThrow("Failed to fetch dynamically imported module");
  });
});

describe("createMembershipStoreProbe", () => {
  it("keeps callers on the membership-store seam", async () => {
    const probe = vi.fn(async () => {});
    const load = vi.fn(async () => ({ probe }));
    const mirrorProbe = createMembershipStoreProbe(load);

    await mirrorProbe.probe({ url: "https://x.convex.cloud", deviceKey: "k" });

    expect(load).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledWith({ url: "https://x.convex.cloud", deviceKey: "k" });
  });

  it("loads the default probe only when the health check runs", async () => {
    convex.probe.mockClear();

    await defaultMembershipStoreProbe.probe({ url: "https://x.convex.cloud", deviceKey: "k" });

    expect(convex.probe).toHaveBeenCalledWith({ url: "https://x.convex.cloud", deviceKey: "k" });
  });
});
