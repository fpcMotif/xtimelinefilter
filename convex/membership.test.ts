// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

// Vite/Vitest + Node globals available at test runtime but absent from the
// bare convex/ tsconfig (which has no @types/node and no Vite client types).
declare const process: { env: Record<string, string | undefined> };
declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

const DEVICE_KEY = "test-device-key";
const WRONG_KEY = "nope";

// convex-test discovers convex/ modules via this glob; it must include the
// _generated directory.
const modules = import.meta.glob("./**/*.*s");

// Frozen clock so addedAt/lastSeenAt/at are deterministic.
const T0 = 1_700_000_000_000;

beforeEach(() => {
  process.env.LASSO_DEVICE_KEY = DEVICE_KEY;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

const owner = { userId: "100", screenName: "operator" };
const otherOwner = { userId: "200", screenName: "alt" };
const list = { listId: "L1", name: "Builders", isPrivate: false, memberCount: 3 };

describe("recordAssign", () => {
  test("upserts Owner + List and appends one event per result", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
          observedAt: T0,
        },
        {
          memberScreenName: "bob",
          memberIdentity: "user:bob",
          action: "add",
          outcome: "already-member",
        },
      ],
    });

    const { accounts, lists, events } = await t.run(async (ctx) => ({
      accounts: await ctx.db.query("accounts").collect(),
      lists: await ctx.db.query("lists").collect(),
      events: await ctx.db.query("events").collect(),
    }));

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      userId: "100",
      screenName: "operator",
      firstSeenAt: T0,
      lastSeenAt: T0,
    });

    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({
      listId: "L1",
      name: "Builders",
      ownerUserId: "100",
    });
    expect(lists[0]?.isPrivate).toBeUndefined();
    expect(lists[0]?.memberCount).toBeUndefined();

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.memberScreenName).toSorted()).toEqual(["alice", "bob"]);
    for (const e of events) {
      expect(e).toMatchObject({ listId: "L1", ownerUserId: "100", action: "add", at: T0 });
    }
  });

  test("keeps an Owner's known handle when a later account read is blank", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner: { userId: owner.userId, screenName: "" },
      list,
      results: [],
    });

    const accounts = await t.run((ctx) => ctx.db.query("accounts").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ userId: owner.userId, screenName: owner.screenName });
  });

  test('sets present:true on "added" and "already-member"', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
        },
        {
          memberScreenName: "bob",
          memberIdentity: "user:bob",
          action: "add",
          outcome: "already-member",
        },
      ],
    });

    const members = await t.run((ctx) => ctx.db.query("members").collect());
    expect(members).toHaveLength(2);
    for (const m of members) {
      expect(m).toMatchObject({ present: true, source: "extension", listId: "L1" });
    }
  });

  test('sets present:false on "removed"', async () => {
    const t = convexTest(schema, modules);

    // First add, then remove the same member.
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
        },
      ],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "remove",
          outcome: "removed",
        },
      ],
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_list_member", (q) => q.eq("listId", "L1").eq("memberScreenName", "alice"))
        .unique(),
    );
    expect(row).toMatchObject({ present: false, source: "extension" });

    const events = await t.run((ctx) => ctx.db.query("events").collect());
    expect(events).toHaveLength(2); // add + remove both logged
  });

  test("patches memberUserId onto an existing snapshot row when re-recorded with an id", async () => {
    const t = convexTest(schema, modules);

    // First add resolves no numeric id; the second carries one and must be
    // patched onto the existing row (the memberUserId-present branch).
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "tweet:1",
          action: "add",
          outcome: "added",
        },
      ],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberUserId: "777",
          memberIdentity: "tweet:1",
          action: "add",
          outcome: "already-member",
        },
      ],
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_list_member", (q) => q.eq("listId", "L1").eq("memberScreenName", "alice"))
        .unique(),
    );
    expect(row).toMatchObject({ present: true, memberUserId: "777" });
  });

  test("preserves reconciled isPrivate/memberCount when a later result omits them", async () => {
    const t = convexTest(schema, modules);

    // replaceCatalog stores the metadata X reports for the List…
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [{ listId: "L1", name: "Builders", isPrivate: true, memberCount: 42 }],
    });

    // …then a recordAssign carrying only { listId, name } must NOT strip it.
    // (db.patch deletes fields set to undefined, so the pre-fix unconditional
    // `isPrivate: list.isPrivate` erased the reconciled values.)
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list: { listId: "L1", name: "Builders" },
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
        },
      ],
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("lists")
        .withIndex("by_listId", (q) => q.eq("listId", "L1"))
        .unique(),
    );
    expect(row).toMatchObject({ isPrivate: true, memberCount: 42, lastReconciledAt: T0 });
  });

  test('does NOT touch snapshot on "failed" / "rate-limited" / "protected" but still appends events', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "carol",
          memberIdentity: "user:carol",
          action: "add",
          outcome: "failed",
        },
        {
          memberScreenName: "dave",
          memberIdentity: "user:dave",
          action: "add",
          outcome: "rate-limited",
        },
        {
          memberScreenName: "erin",
          memberIdentity: "user:erin",
          action: "add",
          outcome: "protected",
        },
      ],
    });

    const { members, events } = await t.run(async (ctx) => ({
      members: await ctx.db.query("members").collect(),
      events: await ctx.db.query("events").collect(),
    }));

    expect(members).toHaveLength(0); // snapshot untouched
    expect(events).toHaveLength(3); // every outcome logged
    expect(events.map((e) => e.outcome).toSorted()).toEqual([
      "failed",
      "protected",
      "rate-limited",
    ]);
  });

  test("keeps a null-identity result in the audit log but out of snapshots", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [{ memberScreenName: "display-only", action: "add", outcome: "added" }],
    });

    const rows = await t.run(async (ctx) => ({
      events: await ctx.db.query("events").collect(),
      members: await ctx.db.query("members").collect(),
    }));
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0]).toMatchObject({ memberScreenName: "display-only", outcome: "added" });
    expect(rows.events[0]?.memberIdentity).toBeUndefined();
    expect(rows.members).toHaveLength(0);
  });

  test("updates display data without forking one stable user identity", async () => {
    const t = convexTest(schema, modules);
    for (const memberScreenName of ["old-handle", "new-handle"]) {
      await t.mutation(api.membership.recordAssign, {
        deviceKey: DEVICE_KEY,
        owner,
        list,
        results: [
          {
            memberScreenName,
            memberUserId: "7",
            memberIdentity: "user:7",
            action: "add",
            outcome: "added",
          },
        ],
      });
    }

    const members = await t.run((ctx) => ctx.db.query("members").collect());
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      memberIdentity: "user:7",
      memberScreenName: "new-handle",
      memberUserId: "7",
    });
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(2);
  });

  test("does not merge two users that reuse one handle", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "shared",
          memberIdentity: "user:7",
          action: "add",
          outcome: "added",
        },
        {
          memberScreenName: "shared",
          memberIdentity: "user:8",
          action: "remove",
          outcome: "removed",
        },
      ],
    });

    const first = await t.query(api.membership.listsContaining, {
      deviceKey: DEVICE_KEY,
      memberIdentity: "user:7",
    });
    const second = await t.query(api.membership.listsContaining, {
      deviceKey: DEVICE_KEY,
      memberIdentity: "user:8",
    });
    expect(first.map((hit) => hit.present)).toEqual([true]);
    expect(second.map((hit) => hit.present)).toEqual([false]);
  });
});

describe("reconcileAuthor", () => {
  test("mirrors X's truth: a List dropped from listIds flips present:true -> false", async () => {
    const t = convexTest(schema, modules);

    // Catalog two Owner-owned Lists.
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [
        { listId: "L1", name: "Builders" },
        { listId: "L2", name: "Friends" },
      ],
    });

    // First reconcile: member is in both L1 and L2.
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0,
      listIds: ["L1", "L2"],
    });

    let rows = await t.run((ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_member", (q) => q.eq("memberScreenName", "alice"))
        .collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.present && r.source === "x-seed")).toBe(true);

    // X now reports alice only in L1: L2 must flip to present:false.
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0,
      listIds: ["L1"],
    });

    rows = await t.run((ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_member", (q) => q.eq("memberScreenName", "alice"))
        .collect(),
    );
    const byList = Object.fromEntries(rows.map((r) => [r.listId, r.present]));
    expect(byList).toEqual({ L1: true, L2: false });
  });

  test("does not write snapshots when stable identity is absent", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [{ listId: "L1", name: "Builders" }],
    });

    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "display-only",
      listIds: ["L1"],
    });

    expect(await t.run((ctx) => ctx.db.query("members").collect())).toHaveLength(0);
    expect(await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY })).toHaveLength(1);
  });

  test("treats missing legacy generations as generation zero", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("accounts", {
        ...owner,
        firstSeenAt: T0,
        lastSeenAt: T0,
      });
      await ctx.db.insert("lists", {
        listId: "L1",
        name: "Legacy",
        ownerUserId: owner.userId,
      });
    });

    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0,
      listIds: ["L1"],
    });

    const catalog = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });
    expect(catalog[0]?.lists).toEqual([{ listId: "L1", name: "Legacy" }]);
    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:alice",
      }),
    ).resolves.toEqual([
      { listId: "L1", ownerUserId: owner.userId, present: true, lastSeenAt: T0 },
    ]);
  });
});

describe("replaceCatalog", () => {
  test("an empty complete catalog advances freshness and hides stale rows without deleting audit", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list: { listId: "L1", name: "Deleted" },
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
        },
      ],
    });
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [],
    });

    const catalog = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });
    const memberships = await t.query(api.membership.listsContaining, {
      deviceKey: DEVICE_KEY,
      memberIdentity: "user:alice",
    });
    expect(catalog).toEqual([{ owner, lists: [], lastReconciledAt: T0 + 1 }]);
    expect(memberships).toEqual([]);

    const rows = await t.run(async (ctx) => ({
      accounts: await ctx.db.query("accounts").collect(),
      lists: await ctx.db.query("lists").collect(),
      members: await ctx.db.query("members").collect(),
      events: await ctx.db.query("events").collect(),
    }));
    expect(rows.accounts[0]).toMatchObject({ catalogGeneration: 1, catalogObservedAt: T0 + 1 });
    expect(rows.lists).toHaveLength(1);
    expect(rows.members).toHaveLength(1);
    expect(rows.events).toHaveLength(1);
  });

  test("replaces a partially overlapping complete catalog", async () => {
    const t = convexTest(schema, modules);
    for (const candidate of [
      { listId: "L1", name: "Old" },
      { listId: "L2", name: "Keep" },
    ]) {
      await t.mutation(api.membership.recordAssign, {
        deviceKey: DEVICE_KEY,
        owner,
        list: candidate,
        results: [
          {
            memberScreenName: `member-${candidate.listId}`,
            memberIdentity: `user:member-${candidate.listId}`,
            action: "add",
            outcome: "added",
            observedAt: T0,
          },
        ],
      });
    }

    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [
        { listId: "L2", name: "Renamed" },
        { listId: "L3", name: "New" },
      ],
    });

    const catalog = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });
    expect(catalog[0]?.lists.map(({ listId, name }) => ({ listId, name }))).toEqual([
      { listId: "L2", name: "Renamed" },
      { listId: "L3", name: "New" },
    ]);
    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:member-L1",
      }),
    ).resolves.toEqual([]);
    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:member-L2",
      }),
    ).resolves.toEqual([
      { listId: "L2", ownerUserId: owner.userId, present: true, lastSeenAt: T0 },
    ]);
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(2);
  });

  test("replaces only the named Owner's generation", async () => {
    const t = convexTest(schema, modules);
    for (const [targetOwner, targetList, memberIdentity] of [
      [owner, { listId: "L1", name: "Primary" }, "user:alice"],
      [otherOwner, { listId: "L2", name: "Other" }, "user:bob"],
    ] as const) {
      await t.mutation(api.membership.recordAssign, {
        deviceKey: DEVICE_KEY,
        owner: targetOwner,
        list: targetList,
        results: [
          {
            memberScreenName: memberIdentity,
            memberIdentity,
            action: "add",
            outcome: "added",
            observedAt: T0,
          },
        ],
      });
    }

    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [],
    });

    const catalog = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });
    const byOwner = Object.fromEntries(
      catalog.map((group) => [group.owner.userId, group.lists.map((row) => row.listId)]),
    );
    expect(byOwner).toEqual({ "100": [], "200": ["L2"] });
    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:alice",
      }),
    ).resolves.toEqual([]);
    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:bob",
      }),
    ).resolves.toEqual([
      { listId: "L2", ownerUserId: otherOwner.userId, present: true, lastSeenAt: T0 },
    ]);
  });

  test("keeps stale snapshot rows inert for bounded later garbage collection", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [{ listId: "L1", name: "Deleted" }],
    });
    await t.run((ctx) =>
      ctx.db.insert("members", {
        listId: "L1",
        memberScreenName: "alice",
        memberIdentity: "user:alice",
        present: true,
        source: "x-seed",
        addedAt: T0,
        lastSeenAt: T0,
      }),
    );

    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [],
    });

    expect(await t.run((ctx) => ctx.db.query("members").collect())).toHaveLength(1);
    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:alice",
      }),
    ).resolves.toEqual([]);
  });

  test("reuses a retained snapshot when its List reappears in a newer catalog", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      ownerObservedAt: T0,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
          observedAt: T0,
        },
      ],
    });
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [],
    });
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 2,
      lists: [{ listId: list.listId, name: list.name }],
    });

    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:alice",
      }),
    ).resolves.toEqual([
      { listId: list.listId, ownerUserId: owner.userId, present: true, lastSeenAt: T0 },
    ]);
  });

  test("ignores an older complete answer that arrives after a newer one", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 2,
      lists: [{ listId: "L2", name: "Newer" }],
    });
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [{ listId: "L1", name: "Older" }],
    });

    const catalog = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });
    expect(catalog).toEqual([
      {
        owner,
        lists: [{ listId: "L2", name: "Newer", lastReconciledAt: T0 }],
        lastReconciledAt: T0 + 2,
      },
    ]);
    const account = await t.run((ctx) => ctx.db.query("accounts").unique());
    expect(account).toMatchObject({ catalogGeneration: 1, catalogObservedAt: T0 + 2 });
  });

  test("accepts an exact fetch-start tie and lets the last response win", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [{ listId: "L1", name: "First" }],
    });
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [{ listId: "L2", name: "Last" }],
    });

    const catalog = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });
    expect(catalog).toEqual([
      {
        owner,
        lists: [{ listId: "L2", name: "Last", lastReconciledAt: T0 }],
        lastReconciledAt: T0,
      },
    ]);
    const account = await t.run((ctx) => ctx.db.query("accounts").unique());
    expect(account).toMatchObject({ catalogGeneration: 2, catalogObservedAt: T0 });
  });

  test("a failed-only audit cannot reactivate a stale List, but a real outcome can", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [{ listId: "L1", name: "Stale" }],
    });
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list: { listId: "L1", name: "Stale" },
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "failed",
          observedAt: T0 + 2,
        },
      ],
    });
    expect((await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY }))[0]?.lists).toEqual(
      [],
    );
    expect(
      (await t.run((ctx) => ctx.db.query("accounts").unique()))?.catalogFactObservedAt,
    ).toBeUndefined();

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list: { listId: "L1", name: "Current" },
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "already-member",
          observedAt: T0 + 3,
        },
      ],
    });
    expect((await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY }))[0]?.lists).toEqual([
      { listId: "L1", name: "Stale", lastReconciledAt: T0 },
    ]);
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(2);
  });
});

describe("causal membership observations", () => {
  test("an older author answer cannot overwrite a newer author answer", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [{ listId: "L1", name: "Builders" }],
    });
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 3,
      listIds: ["L1"],
    });
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 2,
      listIds: [],
    });

    const row = await t.run((ctx) => ctx.db.query("members").unique());
    expect(row).toMatchObject({ present: true, source: "x-seed", observedAt: T0 + 3 });
  });

  test("an author answer older than the active complete catalog is ignored", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 2,
      lists: [{ listId: "L1", name: "Builders" }],
    });
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 1,
      listIds: ["L1"],
    });

    expect(await t.run((ctx) => ctx.db.query("members").collect())).toEqual([]);
  });

  test("older author answers cannot overwrite newer direct add or remove facts", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [{ listId: "L1", name: "Builders" }],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
          observedAt: T0 + 3,
        },
      ],
    });
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 2,
      listIds: [],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "remove",
          outcome: "removed",
          observedAt: T0 + 5,
        },
      ],
    });
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 4,
      listIds: ["L1"],
    });

    const row = await t.run((ctx) => ctx.db.query("members").unique());
    expect(row).toMatchObject({ present: false, source: "extension", observedAt: T0 + 5 });
    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:alice",
      }),
    ).resolves.toEqual([
      { listId: "L1", ownerUserId: owner.userId, present: false, lastSeenAt: T0 + 5 },
    ]);
    const events = await t.run((ctx) => ctx.db.query("events").collect());
    expect(events.map((event) => event.observedAt)).toEqual([T0 + 3, T0 + 5]);
  });

  test("direct actions win equal-time ties; same-source ties use last arrival", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [{ listId: "L1", name: "Builders" }],
    });
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 2,
      listIds: ["L1"],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "remove",
          outcome: "removed",
          observedAt: T0 + 2,
        },
      ],
    });
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 2,
      listIds: ["L1"],
    });
    expect(await t.run((ctx) => ctx.db.query("members").unique())).toMatchObject({
      present: false,
      source: "extension",
      observedAt: T0 + 2,
    });

    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 3,
      listIds: ["L1"],
    });
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 3,
      listIds: [],
    });
    expect(await t.run((ctx) => ctx.db.query("members").unique())).toMatchObject({
      present: false,
      source: "x-seed",
      observedAt: T0 + 3,
    });
  });

  test("a newer observation upgrades a legacy row whose missing time means zero", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [{ listId: "L1", name: "Builders" }],
    });
    await t.run((ctx) =>
      ctx.db.insert("members", {
        listId: "L1",
        memberScreenName: "alice",
        memberIdentity: "user:alice",
        present: false,
        source: "x-seed",
        addedAt: T0,
        lastSeenAt: T0,
      }),
    );
    await t.mutation(api.membership.reconcileAuthor, {
      deviceKey: DEVICE_KEY,
      owner,
      screenName: "alice",
      memberIdentity: "user:alice",
      observedAt: T0 + 2,
      listIds: ["L1"],
    });

    expect(await t.run((ctx) => ctx.db.query("members").unique())).toMatchObject({
      present: true,
      observedAt: T0 + 2,
    });
  });

  test("a proven action wins an equal-time catalog and cannot overwrite catalog metadata", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [{ listId: "L1", name: "Catalog name", memberCount: 7 }],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner: { ...owner, screenName: "new-handle" },
      ownerObservedAt: T0 + 3,
      list: { listId: "L1", name: "Stale action name" },
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
          observedAt: T0 + 3,
        },
      ],
    });
    vi.setSystemTime(T0 + 100);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner: { ...owner, screenName: "stale-handle" },
      observedAt: T0 + 3,
      lists: [],
    });

    expect(await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY })).toEqual([
      {
        owner: { ...owner, screenName: "new-handle" },
        lists: [
          {
            listId: "L1",
            name: "Catalog name",
            memberCount: 7,
            lastReconciledAt: T0,
          },
        ],
        lastReconciledAt: T0 + 1,
      },
    ]);
    expect(await t.run((ctx) => ctx.db.query("accounts").unique())).toMatchObject({
      catalogFactObservedAt: T0 + 3,
      profileObservedAt: T0 + 3,
      lastSeenAt: T0,
    });
  });

  test("a delayed action older than the complete catalog stays audit-only for catalog state", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 3,
      lists: [],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner: { ...owner, screenName: "stale-handle" },
      ownerObservedAt: T0 + 2,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
          observedAt: T0 + 2,
        },
      ],
    });

    expect(await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY })).toEqual([
      { owner, lists: [], lastReconciledAt: T0 + 3 },
    ]);
    expect(await t.run((ctx) => ctx.db.query("lists").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("events").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("accounts").unique())).toMatchObject({
      screenName: owner.screenName,
      catalogObservedAt: T0 + 3,
    });
    expect(
      (await t.run((ctx) => ctx.db.query("accounts").unique()))?.catalogFactObservedAt,
    ).toBeUndefined();
  });

  test("a late action uses its Owner-read time instead of its result time for profile data", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner: { ...owner, screenName: "current-handle" },
      observedAt: T0 + 2,
      lists: [{ listId: "L1", name: "Builders" }],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner: { ...owner, screenName: "pre-run-handle" },
      ownerObservedAt: T0 + 1,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
          observedAt: T0 + 3,
        },
      ],
    });

    expect(await t.run((ctx) => ctx.db.query("accounts").unique())).toMatchObject({
      screenName: "current-handle",
      profileObservedAt: T0 + 2,
      catalogFactObservedAt: T0 + 3,
    });
  });

  test("a later fact for another List does not suppress an older current List proof", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0 + 1,
      lists: [],
    });
    for (const [targetList, observedAt] of [
      [{ listId: "L2", name: "Later fact" }, T0 + 3],
      [{ listId: "L1", name: "Earlier arrival" }, T0 + 2],
    ] as const) {
      await t.mutation(api.membership.recordAssign, {
        deviceKey: DEVICE_KEY,
        owner,
        list: targetList,
        results: [
          {
            memberScreenName: "alice",
            memberIdentity: "user:alice",
            action: "add",
            outcome: "added",
            observedAt,
          },
        ],
      });
    }

    const catalog = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });
    expect(catalog[0]?.lists.map((row) => row.listId).toSorted()).toEqual(["L1", "L2"]);
    expect(await t.run((ctx) => ctx.db.query("accounts").unique())).toMatchObject({
      catalogFactObservedAt: T0 + 3,
    });
  });
});

describe("listsContaining", () => {
  test("returns rows for a screenName with correct present + ownerUserId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        {
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          action: "add",
          outcome: "added",
          observedAt: T0,
        },
      ],
    });

    const out = await t.query(api.membership.listsContaining, {
      deviceKey: DEVICE_KEY,
      memberIdentity: "user:alice",
    });

    expect(out).toEqual([{ listId: "L1", ownerUserId: "100", present: true, lastSeenAt: T0 }]);
  });

  test("skips snapshot rows whose List is unknown (join miss)", async () => {
    const t = convexTest(schema, modules);

    // Snapshot row inserted directly with no matching list row.
    await t.run((ctx) =>
      ctx.db.insert("members", {
        listId: "orphan",
        memberScreenName: "ghost",
        memberIdentity: "user:ghost",
        present: true,
        source: "x-seed",
        addedAt: T0,
        lastSeenAt: T0,
      }),
    );

    const out = await t.query(api.membership.listsContaining, {
      deviceKey: DEVICE_KEY,
      memberIdentity: "user:ghost",
    });
    expect(out).toEqual([]);
  });

  test("query cost follows current Lists, not inert membership history", async () => {
    const t = convexTest({
      schema,
      modules,
      transactionLimits: { databaseQueries: 8 },
    });
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [{ listId: "L1", name: "Current" }],
    });
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        await ctx.db.insert("members", {
          listId: `historical-${i}`,
          memberScreenName: "alice",
          memberIdentity: "user:alice",
          present: true,
          source: "x-seed",
          observedAt: T0 - 1,
          addedAt: T0,
          lastSeenAt: T0,
        });
      }
      await ctx.db.insert("members", {
        listId: "L1",
        memberScreenName: "alice",
        memberIdentity: "user:alice",
        present: true,
        source: "x-seed",
        observedAt: T0,
        addedAt: T0,
        lastSeenAt: T0,
      });
    });

    await expect(
      t.query(api.membership.listsContaining, {
        deviceKey: DEVICE_KEY,
        memberIdentity: "user:alice",
      }),
    ).resolves.toEqual([
      { listId: "L1", ownerUserId: owner.userId, present: true, lastSeenAt: T0 },
    ]);
  });

  test("does not trust a legacy handle-keyed snapshot", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("members", {
        listId: "L1",
        memberScreenName: "reused-handle",
        present: true,
        source: "extension",
        addedAt: T0,
        lastSeenAt: T0,
      }),
    );

    const out = await t.query(api.membership.listsContaining, {
      deviceKey: DEVICE_KEY,
      memberIdentity: "user:7",
    });
    expect(out).toEqual([]);
  });
});

describe("catalog", () => {
  test("groups Lists under their Owner", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      observedAt: T0,
      lists: [
        { listId: "L1", name: "Builders" },
        { listId: "L2", name: "Friends" },
      ],
    });
    await t.mutation(api.membership.replaceCatalog, {
      deviceKey: DEVICE_KEY,
      owner: otherOwner,
      observedAt: T0,
      lists: [{ listId: "L3", name: "Alt list" }],
    });

    const out = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });

    const byOwner = Object.fromEntries(
      out.map((g) => [g.owner.userId, g.lists.map((l) => l.listId).toSorted()]),
    );
    expect(byOwner).toEqual({ "100": ["L1", "L2"], "200": ["L3"] });

    const operatorGroup = out.find((g) => g.owner.userId === "100");
    expect(operatorGroup?.owner.screenName).toBe("operator");
    expect(operatorGroup?.lists[0]).toMatchObject({ lastReconciledAt: T0 });
  });
});

describe("device-key gate", () => {
  const cases: Array<{ name: string; run: (key: string) => Promise<unknown> }> = [
    {
      name: "recordAssign",
      run: (key) =>
        convexTest(schema, modules).mutation(api.membership.recordAssign, {
          deviceKey: key,
          owner,
          list,
          results: [{ memberScreenName: "alice", action: "add", outcome: "added" }],
        }),
    },
    {
      name: "reconcileAuthor",
      run: (key) =>
        convexTest(schema, modules).mutation(api.membership.reconcileAuthor, {
          deviceKey: key,
          owner,
          screenName: "alice",
          memberIdentity: "user:alice",
          listIds: ["L1"],
        }),
    },
    {
      name: "replaceCatalog",
      run: (key) =>
        convexTest(schema, modules).mutation(api.membership.replaceCatalog, {
          deviceKey: key,
          owner,
          observedAt: T0,
          lists: [{ listId: "L1", name: "Builders" }],
        }),
    },
    {
      name: "listsContaining",
      run: (key) =>
        convexTest(schema, modules).query(api.membership.listsContaining, {
          deviceKey: key,
          memberIdentity: "user:alice",
        }),
    },
    {
      name: "catalog",
      run: (key) => convexTest(schema, modules).query(api.membership.catalog, { deviceKey: key }),
    },
  ];

  test.each(cases)("$name rejects a wrong device key", async ({ run }) => {
    await expect(run(WRONG_KEY)).rejects.toThrow(/invalid device key/);
  });

  test.each(cases)("$name rejects when LASSO_DEVICE_KEY is unset", async ({ run }) => {
    delete process.env.LASSO_DEVICE_KEY;
    await expect(run(DEVICE_KEY)).rejects.toThrow(/invalid device key/);
  });
});
