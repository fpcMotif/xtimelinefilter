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
const noop = (): void => {};

const refs: MembershipApiRefs = {
  recordAssign: "ref.recordAssign",
  reconcileAuthor: "ref.reconcileAuthor",
  replaceCatalog: "ref.replaceCatalog",
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
  it("observe emits a valid snapshot; its disposer is idempotent", async () => {
    const store = make();
    const snapshot = await new Promise<{ catalog: OwnerCatalog[]; memberships: MembershipHit[] }>(
      (resolve) => {
        let stop = noop;
        stop = store.observe({ kind: "single", identity: "user:alice" }, (next) => {
          stop();
          resolve(next);
        });
      },
    );
    expect(snapshot.catalog.every(isOwnerCatalog)).toBe(true);
    expect(snapshot.memberships.every(isMembershipHit)).toBe(true);
    const stop = make().observe({ kind: "bulk" }, noop);
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });

  it("recordAssign resolves", async () => {
    await expect(
      make().recordAssign(owner, list, {
        ownerObservedAt: 122,
        changes: [
          {
            screenName: "alice",
            identity: "user:alice",
            action: "add",
            outcome: "added",
            observedAt: 123,
          },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("reconcileAuthor resolves", async () => {
    await expect(
      make().reconcileAuthor(
        owner,
        { screenName: "alice", identity: "user:alice" },
        { listIds: ["L1"], observedAt: 123, ownerObservedAt: 122 },
      ),
    ).resolves.toBeUndefined();
  });

  it("replaceCatalog resolves", async () => {
    await expect(
      make().replaceCatalog(owner, { lists: [list], observedAt: 123, ownerObservedAt: 122 }),
    ).resolves.toBeUndefined();
  });
});

// Teeth: snapshot validation and write-resolves must reject a broken adapter.
describe("the contract has teeth", () => {
  const wrongShapeSnapshotStore: MembershipStore = {
    async recordAssign() {},
    async reconcileAuthor() {},
    async replaceCatalog() {},
    observe(_subject, emit) {
      emit({ catalog: [{ owner: { userId: 1 } }] as unknown as OwnerCatalog[], memberships: [] });
      return () => {};
    },
  };
  const rejectingWriteStore: MembershipStore = {
    async recordAssign() {
      throw new Error("mirror down");
    },
    async reconcileAuthor() {},
    async replaceCatalog() {},
    observe() {
      return () => {};
    },
  };

  it("a wrong-shape snapshot fails the OwnerCatalog check", () => {
    wrongShapeSnapshotStore.observe({ kind: "bulk" }, (snapshot) => {
      expect(snapshot.catalog.every(isOwnerCatalog)).toBe(false);
    });
  });

  it("a throwing write fails the resolves check", async () => {
    await expect(
      rejectingWriteStore.recordAssign(owner, list, { changes: [], ownerObservedAt: 123 }),
    ).rejects.toThrow("mirror down");
  });
});
