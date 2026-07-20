import { describe, expect, it } from "vitest";

import {
  type ConvexCalls,
  ConvexMembershipStore,
  type MembershipApiRefs,
} from "@/packages/membership-store/convex";
import type { Owner } from "@/packages/membership-store/types";
import type { XList } from "@/packages/x-client/types";

const refs: MembershipApiRefs = {
  recordAssign: "ref.recordAssign",
  reconcileAuthor: "ref.reconcileAuthor",
  replaceCatalog: "ref.replaceCatalog",
  listsContaining: "ref.listsContaining",
  catalog: "ref.catalog",
};
const owner: Owner = { userId: "100", screenName: "operator" };
const list: XList = { id: "L1", name: "Builders", isPrivate: true, memberCount: 5 };
const KEY = "dk";

class FakeConvex implements ConvexCalls {
  calls: Array<{ kind: "mutation" | "query"; ref: unknown; args: Record<string, unknown> }> = [];
  queryResults = new Map<unknown, unknown>();
  async mutation(ref: unknown, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ kind: "mutation", ref, args });
    return null;
  }
  async query(ref: unknown, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ kind: "query", ref, args });
    return this.queryResults.get(ref) ?? null;
  }
}

function make() {
  const fake = new FakeConvex();
  return { fake, store: new ConvexMembershipStore(fake, refs, KEY) };
}

describe("ConvexMembershipStore", () => {
  it("falls back to one-shot catalog observation for bulk subjects", async () => {
    const { fake, store } = make();
    fake.queryResults.set(refs.catalog, []);
    const snapshots: unknown[] = [];
    const stop = store.observe({ kind: "bulk" }, (snapshot) => snapshots.push(snapshot));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toEqual([{ catalog: [], memberships: [] }]);
    stop();
  });

  it("suppresses disposed and failed one-shot observations", async () => {
    const { fake, store } = make();
    let release!: (value: unknown[]) => void;
    fake.queryResults.set(
      refs.catalog,
      new Promise<unknown[]>((resolve) => {
        release = resolve;
      }),
    );
    fake.queryResults.set(refs.listsContaining, []);
    const snapshots: unknown[] = [];
    const stop = store.observe({ kind: "single", identity: "user:alice" }, (snapshot) =>
      snapshots.push(snapshot),
    );
    stop();
    release([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toEqual([]);

    fake.queryResults.set(refs.catalog, Promise.reject(new Error("offline")));
    store.observe({ kind: "bulk" }, (snapshot) => snapshots.push(snapshot));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toEqual([]);
  });

  it("recordAssign maps changes to results (action+outcome), list.id->listId, with deviceKey", async () => {
    const { fake, store } = make();
    await store.recordAssign(owner, list, {
      ownerObservedAt: 122,
      changes: [
        {
          screenName: "alice",
          userId: "9",
          identity: "user:9",
          action: "add",
          outcome: "added",
          observedAt: 123,
        },
        {
          screenName: "bob",
          identity: null,
          action: "remove",
          outcome: "removed",
          observedAt: 124,
        },
      ],
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual({
      kind: "mutation",
      ref: refs.recordAssign,
      args: {
        deviceKey: KEY,
        owner,
        ownerObservedAt: 122,
        list: { listId: "L1", name: "Builders", isPrivate: true, memberCount: 5 },
        results: [
          {
            memberScreenName: "alice",
            memberUserId: "9",
            memberIdentity: "user:9",
            action: "add",
            outcome: "added",
            observedAt: 123,
          },
          {
            memberScreenName: "bob",
            action: "remove",
            outcome: "removed",
            observedAt: 124,
          },
        ],
      },
    });
  });

  it("fallback observation reads memberships with deviceKey+screenName", async () => {
    const { fake, store } = make();
    const hits = [{ listId: "L1", ownerUserId: "100", present: true, lastSeenAt: 7 }];
    fake.queryResults.set(refs.catalog, []);
    fake.queryResults.set(refs.listsContaining, hits);
    const snapshots: unknown[] = [];
    store.observe({ kind: "single", identity: "user:9" }, (snapshot) => snapshots.push(snapshot));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toEqual([{ catalog: [], memberships: hits }]);
    expect(fake.calls).toContainEqual({
      kind: "query",
      ref: refs.listsContaining,
      args: { deviceKey: KEY, memberIdentity: "user:9" },
    });
  });

  it("fallback observation maps listId->id and derives per-Owner lastReconciledAt (max)", async () => {
    const { fake, store } = make();
    fake.queryResults.set(refs.catalog, [
      {
        owner,
        lists: [
          { listId: "L1", name: "A", isPrivate: false, lastReconciledAt: 10 },
          { listId: "L2", name: "B", memberCount: 3, lastReconciledAt: 25 },
        ],
      },
    ]);
    const snapshots: unknown[] = [];
    store.observe({ kind: "bulk" }, (snapshot) => snapshots.push(snapshot));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toEqual([
      {
        catalog: [
          {
            owner,
            lists: [
              { id: "L1", name: "A", isPrivate: false },
              { id: "L2", name: "B", memberCount: 3 },
            ],
            lastReconciledAt: 25,
          },
        ],
        memberships: [],
      },
    ]);
  });

  it("omits lastReconciledAt when fallback catalog rows lack it", async () => {
    const { fake, store } = make();
    fake.queryResults.set(refs.catalog, [
      { owner, lists: [{ listId: "L1", name: "A" }] }, // no lastReconciledAt anywhere
    ]);
    const snapshots: unknown[] = [];
    store.observe({ kind: "bulk" }, (snapshot) => snapshots.push(snapshot));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toEqual([
      { catalog: [{ owner, lists: [{ id: "L1", name: "A" }] }], memberships: [] },
    ]);
  });

  it("keeps Owner freshness when a complete catalog is empty", async () => {
    const { fake, store } = make();
    fake.queryResults.set(refs.catalog, [{ owner, lists: [], lastReconciledAt: 123 }]);
    const snapshots: unknown[] = [];
    store.observe({ kind: "bulk" }, (snapshot) => snapshots.push(snapshot));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toEqual([
      {
        catalog: [{ owner, lists: [], lastReconciledAt: 123 }],
        memberships: [],
      },
    ]);
  });

  it("replaceCatalog maps each XList.id->listId, observedAt, and omits absent optionals", async () => {
    const { fake, store } = make();
    await store.replaceCatalog(owner, {
      lists: [list, { id: "L2", name: "Friends" }],
      observedAt: 123,
      ownerObservedAt: 122,
    });
    expect(fake.calls[0]).toEqual({
      kind: "mutation",
      ref: refs.replaceCatalog,
      args: {
        deviceKey: KEY,
        owner,
        observedAt: 123,
        ownerObservedAt: 122,
        lists: [
          { listId: "L1", name: "Builders", isPrivate: true, memberCount: 5 },
          { listId: "L2", name: "Friends" },
        ],
      },
    });
  });

  it("reconcileAuthor passes owner, screenName, listIds with deviceKey", async () => {
    const { fake, store } = make();
    await store.reconcileAuthor(
      owner,
      { screenName: "alice", identity: "user:9" },
      { listIds: ["L1", "L2"], observedAt: 123, ownerObservedAt: 122 },
    );
    expect(fake.calls[0]).toEqual({
      kind: "mutation",
      ref: refs.reconcileAuthor,
      args: {
        deviceKey: KEY,
        owner,
        screenName: "alice",
        memberIdentity: "user:9",
        listIds: ["L1", "L2"],
        observedAt: 123,
        ownerObservedAt: 122,
      },
    });
  });
});
