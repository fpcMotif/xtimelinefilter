import { describe, expect, it, vi } from "vitest";

// Stub the only true external boundary: the Convex HTTP client. Shared spies are
// hoisted so the (hoisted) vi.mock factory can close over them, letting us assert
// buildConvexMembershipStore wires its two arrow delegates onto the http client.
const h = vi.hoisted(() => ({
  mutation: vi.fn(async (..._args: unknown[]) => undefined as unknown),
  query: vi.fn(async (..._args: unknown[]) => [] as unknown),
  ctorUrls: [] as string[],
  subscriptions: [] as Array<{
    args: Record<string, unknown>;
    callback: (value: never) => void;
    onError: () => void;
    stop: ReturnType<typeof vi.fn>;
  }>,
  closes: 0,
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = h.mutation;
    query = h.query;
    constructor(url: string) {
      h.ctorUrls.push(url);
    }
  },
  ConvexClient: class {
    constructor(url: string) {
      h.ctorUrls.push(url);
    }
    onUpdate(
      _ref: unknown,
      args: Record<string, unknown>,
      callback: (value: never) => void,
      onError: () => void,
    ) {
      const stop = vi.fn();
      h.subscriptions.push({ args, callback, onError, stop });
      return stop;
    }
    async close() {
      h.closes++;
    }
  },
}));

import {
  buildConvexMembershipStore,
  testConvexConnection,
} from "@/core/membership-store/convex-client";

import { api } from "../../../convex/_generated/api";

describe("buildConvexMembershipStore", () => {
  it("constructs a ConvexHttpClient at the configured url", () => {
    buildConvexMembershipStore({ url: "https://silent-crab-355.convex.cloud", deviceKey: "dk" });
    expect(h.ctorUrls).toContain("https://silent-crab-355.convex.cloud");
  });

  it("delegates a mutation method onto the http client", async () => {
    h.mutation.mockClear();
    const store = buildConvexMembershipStore({ url: "https://x.convex.cloud", deviceKey: "dk" });
    await store.reconcileAuthor(
      { userId: "9", screenName: "me" },
      { screenName: "alice", identity: "user:10" },
      { listIds: ["L1"], observedAt: 123, ownerObservedAt: 122 },
    );
    expect(h.mutation).toHaveBeenCalledTimes(1);
    expect(h.mutation.mock.calls[0]).toEqual([
      api.membership.reconcileAuthor,
      {
        deviceKey: "dk",
        owner: { userId: "9", screenName: "me" },
        screenName: "alice",
        memberIdentity: "user:10",
        listIds: ["L1"],
        observedAt: 123,
        ownerObservedAt: 122,
      },
    ]);
  });

  it("keeps the HTTP query delegate available to the store seam", async () => {
    h.query.mockClear();
    const store = buildConvexMembershipStore({ url: "https://x.convex.cloud", deviceKey: "dk" });
    const client = store as unknown as {
      client: { query(ref: unknown, args: Record<string, unknown>): Promise<unknown> };
    };

    await client.client.query("catalog", { deviceKey: "dk" });

    expect(h.query).toHaveBeenCalledWith("catalog", { deviceKey: "dk" });
  });

  it("tests a connection with one read-only catalog query", async () => {
    h.query.mockClear();
    h.subscriptions.length = 0;
    h.query.mockResolvedValueOnce([]);
    await testConvexConnection({ url: "https://x.convex.cloud", deviceKey: "dk" });
    expect(h.query).toHaveBeenCalledOnce();
    expect(h.query.mock.calls[0]![1]).toEqual({ deviceKey: "dk" });
    expect(h.subscriptions).toHaveLength(0);
  });

  it("uses reactive queries for observe and closes them on dispose", () => {
    h.subscriptions.length = 0;
    h.closes = 0;
    const store = buildConvexMembershipStore({ url: "https://x.convex.cloud", deviceKey: "dk" });
    const emit = vi.fn();
    const stop = store.observe({ kind: "single", identity: "user:10" }, emit);
    expect(h.subscriptions.map((subscription) => subscription.args)).toEqual([
      { deviceKey: "dk" },
      { deviceKey: "dk", memberIdentity: "user:10" },
    ]);

    h.subscriptions[0]!.callback([
      { owner: { userId: "1", screenName: "me" }, lists: [{ listId: "L1", name: "One" }] },
    ] as never);
    h.subscriptions[1]!.callback([
      { ownerUserId: "1", listId: "L1", present: true, lastSeenAt: 1 },
    ] as never);
    expect(emit).toHaveBeenLastCalledWith({
      catalog: [{ owner: { userId: "1", screenName: "me" }, lists: [{ id: "L1", name: "One" }] }],
      memberships: [{ ownerUserId: "1", listId: "L1", present: true, lastSeenAt: 1 }],
    });

    stop();
    stop();
    h.subscriptions[0]!.callback([] as never);
    h.subscriptions[0]!.onError();
    h.subscriptions[1]!.onError();
    expect(h.subscriptions.every((subscription) => subscription.stop.mock.calls.length === 1)).toBe(
      true,
    );
    expect(h.closes).toBe(1);
  });

  it("observes only the catalog for a bulk subject", () => {
    h.subscriptions.length = 0;
    const store = buildConvexMembershipStore({ url: "https://x.convex.cloud", deviceKey: "dk" });
    const emit = vi.fn();
    const stop = store.observe({ kind: "bulk" }, emit);
    expect(h.subscriptions).toHaveLength(1);
    h.subscriptions[0]!.callback([] as never);
    expect(emit).toHaveBeenCalledWith({ catalog: [], memberships: [] });
    stop();
  });
});
