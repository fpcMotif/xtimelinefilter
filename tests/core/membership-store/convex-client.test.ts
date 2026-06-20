import { describe, expect, it, vi } from "vitest";

// Stub the only true external boundary: the Convex HTTP client. Shared spies are
// hoisted so the (hoisted) vi.mock factory can close over them, letting us assert
// buildConvexMembershipStore wires its two arrow delegates onto the http client.
const h = vi.hoisted(() => ({
  mutation: vi.fn(async (..._args: unknown[]) => undefined as unknown),
  query: vi.fn(async (..._args: unknown[]) => [] as unknown),
  ctorUrls: [] as string[],
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = h.mutation;
    query = h.query;
    constructor(url: string) {
      h.ctorUrls.push(url);
    }
  },
}));

import { buildConvexMembershipStore } from "@/core/membership-store/convex-client";

describe("buildConvexMembershipStore", () => {
  it("constructs a ConvexHttpClient at the configured url", () => {
    buildConvexMembershipStore({ url: "https://silent-crab-355.convex.cloud", deviceKey: "dk" });
    expect(h.ctorUrls).toContain("https://silent-crab-355.convex.cloud");
  });

  it("delegates a mutation method onto the http client", async () => {
    h.mutation.mockClear();
    const store = buildConvexMembershipStore({ url: "https://x.convex.cloud", deviceKey: "dk" });
    await store.reconcileAuthor({ userId: "9", screenName: "me" }, "alice", ["L1"]);
    expect(h.mutation).toHaveBeenCalledTimes(1);
    const [, args] = h.mutation.mock.calls[0]!;
    expect(args).toMatchObject({ deviceKey: "dk", screenName: "alice", listIds: ["L1"] });
  });

  it("delegates a query method onto the http client", async () => {
    h.query.mockClear();
    h.query.mockResolvedValueOnce([]);
    const store = buildConvexMembershipStore({ url: "https://x.convex.cloud", deviceKey: "dk" });
    const hits = await store.listsContaining("alice");
    expect(hits).toEqual([]);
    expect(h.query).toHaveBeenCalledTimes(1);
    const [, args] = h.query.mock.calls[0]!;
    expect(args).toMatchObject({ deviceKey: "dk", screenName: "alice" });
  });
});
