import { describe, expect, it } from "vitest";

import {
  type ConvexCalls,
  ConvexMembershipStore,
  type MembershipApiRefs,
} from "@/core/membership-store/convex";
import type { Owner } from "@/core/membership-store/types";
import type { XList } from "@/core/x-client/types";

const refs: MembershipApiRefs = {
  recordAssign: "ref.recordAssign",
  reconcileAuthor: "ref.reconcileAuthor",
  reconcileCatalog: "ref.reconcileCatalog",
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
  it("recordAssign maps changes to results (action+outcome), list.id->listId, with deviceKey", async () => {
    const { fake, store } = make();
    await store.recordAssign(owner, list, [
      { screenName: "alice", userId: "9", action: "add", outcome: "added" },
      { screenName: "bob", action: "remove", outcome: "removed" },
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual({
      kind: "mutation",
      ref: refs.recordAssign,
      args: {
        deviceKey: KEY,
        owner,
        list: { listId: "L1", name: "Builders", isPrivate: true, memberCount: 5 },
        results: [
          { memberScreenName: "alice", memberUserId: "9", action: "add", outcome: "added" },
          { memberScreenName: "bob", action: "remove", outcome: "removed" },
        ],
      },
    });
  });

  it("listsContaining passes deviceKey+screenName and returns the hits", async () => {
    const { fake, store } = make();
    const hits = [{ listId: "L1", ownerUserId: "100", present: true, lastSeenAt: 7 }];
    fake.queryResults.set(refs.listsContaining, hits);
    expect(await store.listsContaining("alice")).toEqual(hits);
    expect(fake.calls[0]).toMatchObject({
      ref: refs.listsContaining,
      args: { deviceKey: KEY, screenName: "alice" },
    });
  });

  it("catalog maps listId->id and derives per-Owner lastReconciledAt (max)", async () => {
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
    expect(await store.catalog()).toEqual([
      {
        owner,
        lists: [
          { id: "L1", name: "A", isPrivate: false },
          { id: "L2", name: "B", memberCount: 3 },
        ],
        lastReconciledAt: 25,
      },
    ]);
  });

  it("reconcileCatalog maps each XList.id->listId, omitting absent optionals", async () => {
    const { fake, store } = make();
    await store.reconcileCatalog(owner, [list, { id: "L2", name: "Friends" }]);
    expect(fake.calls[0]).toEqual({
      kind: "mutation",
      ref: refs.reconcileCatalog,
      args: {
        deviceKey: KEY,
        owner,
        lists: [
          { listId: "L1", name: "Builders", isPrivate: true, memberCount: 5 },
          { listId: "L2", name: "Friends" },
        ],
      },
    });
  });

  it("reconcileAuthor passes owner, screenName, listIds with deviceKey", async () => {
    const { fake, store } = make();
    await store.reconcileAuthor(owner, "alice", ["L1", "L2"]);
    expect(fake.calls[0]).toEqual({
      kind: "mutation",
      ref: refs.reconcileAuthor,
      args: { deviceKey: KEY, owner, screenName: "alice", listIds: ["L1", "L2"] },
    });
  });
});
