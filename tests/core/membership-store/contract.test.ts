import { describe, expect, it } from "vitest";

import {
  type ConvexCalls,
  ConvexMembershipStore,
  type MembershipApiRefs,
} from "@/core/membership-store/convex";
import { NullMembershipStore } from "@/core/membership-store/null";
import type {
  MembershipHit,
  MembershipStore,
  Owner,
  OwnerCatalog,
} from "@/core/membership-store/types";
import type { XList } from "@/core/x-client/types";

/**
 * The seam's *universal* success-path contract: invariants every MembershipStore
 * implementation must honour, driven through the {@link MembershipStore} interface
 * (not the concrete classes). Per-adapter wire mapping stays in `convex.test.ts`;
 * the integration "Mirror failure never blocks the X flow" proof stays at the
 * controller (`controller.test.ts`) — it is a property of the integration, not the
 * seam, so a pure-seam contract cannot assert it.
 */

const owner: Owner = { userId: "100", screenName: "operator" };
const list: XList = { id: "L1", name: "Builders" };

const refs: MembershipApiRefs = {
  recordAssign: "ref.recordAssign",
  reconcileAuthor: "ref.reconcileAuthor",
  reconcileCatalog: "ref.reconcileCatalog",
  listsContaining: "ref.listsContaining",
  catalog: "ref.catalog",
};

function isMembershipHit(x: unknown): x is MembershipHit {
  const h = x as MembershipHit;
  return (
    typeof h?.listId === "string" &&
    typeof h?.ownerUserId === "string" &&
    typeof h?.present === "boolean" &&
    typeof h?.lastSeenAt === "number"
  );
}

function isOwnerCatalog(x: unknown): x is OwnerCatalog {
  const g = x as OwnerCatalog;
  return (
    typeof g?.owner?.userId === "string" &&
    typeof g?.owner?.screenName === "string" &&
    Array.isArray(g?.lists) &&
    g.lists.every((l) => typeof l?.id === "string" && typeof l?.name === "string") &&
    (g.lastReconciledAt === undefined || typeof g.lastReconciledAt === "number")
  );
}

/** A Convex client whose calls all succeed and whose reads return declared-shape rows. */
class FakeSucceedingConvex implements ConvexCalls {
  async mutation(): Promise<unknown> {
    return null;
  }
  async query(ref: unknown): Promise<unknown> {
    if (ref === refs.listsContaining) {
      return [{ listId: "L1", ownerUserId: "100", present: true, lastSeenAt: 7 }];
    }
    if (ref === refs.catalog) {
      return [{ owner, lists: [{ listId: "L1", name: "Builders", lastReconciledAt: 10 }] }];
    }
    return null;
  }
}

const adapters: Array<{ label: string; make: () => MembershipStore }> = [
  { label: "NullMembershipStore", make: () => new NullMembershipStore() },
  {
    label: "ConvexMembershipStore",
    make: () => new ConvexMembershipStore(new FakeSucceedingConvex(), refs, "dk"),
  },
];

describe.each(adapters)("MembershipStore contract: $label", ({ make }) => {
  it("listsContaining resolves to an array of MembershipHit", async () => {
    const result = await make().listsContaining("alice");
    expect(Array.isArray(result)).toBe(true);
    expect(result.every(isMembershipHit)).toBe(true);
  });

  it("catalog resolves to an array of OwnerCatalog", async () => {
    const result = await make().catalog();
    expect(Array.isArray(result)).toBe(true);
    expect(result.every(isOwnerCatalog)).toBe(true);
  });

  it("recordAssign resolves", async () => {
    await expect(
      make().recordAssign(owner, list, [{ screenName: "alice", action: "add", outcome: "added" }]),
    ).resolves.toBeUndefined();
  });

  it("reconcileAuthor resolves", async () => {
    await expect(make().reconcileAuthor(owner, "alice", ["L1"])).resolves.toBeUndefined();
  });

  it("reconcileCatalog resolves", async () => {
    await expect(make().reconcileCatalog(owner, [list])).resolves.toBeUndefined();
  });
});

// Teeth: the contract's read-shape and write-resolves checks must reject a broken
// adapter — otherwise they are ceremony. These assert the exact predicates the
// contract above relies on, applied to deliberately-wrong implementations.
describe("the contract has teeth", () => {
  const wrongShapeReadStore: MembershipStore = {
    async recordAssign() {},
    async reconcileAuthor() {},
    async reconcileCatalog() {},
    async listsContaining() {
      return [{ listId: 1 } as unknown as MembershipHit];
    },
    async catalog() {
      return [];
    },
  };
  const rejectingWriteStore: MembershipStore = {
    async recordAssign() {
      throw new Error("mirror down");
    },
    async reconcileAuthor() {},
    async reconcileCatalog() {},
    async listsContaining() {
      return [];
    },
    async catalog() {
      return [];
    },
  };

  it("a wrong-shape read fails the MembershipHit check", async () => {
    const result = await wrongShapeReadStore.listsContaining("alice");
    expect(result.every(isMembershipHit)).toBe(false);
  });

  it("a throwing write fails the resolves check", async () => {
    await expect(rejectingWriteStore.recordAssign(owner, list, [])).rejects.toThrow("mirror down");
  });
});
