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
        { memberScreenName: "alice", action: "add", outcome: "added" },
        { memberScreenName: "bob", action: "add", outcome: "already-member" },
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
      isPrivate: false,
      memberCount: 3,
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.memberScreenName).sort()).toEqual(["alice", "bob"]);
    for (const e of events) {
      expect(e).toMatchObject({ listId: "L1", ownerUserId: "100", action: "add", at: T0 });
    }
  });

  test('sets present:true on "added" and "already-member"', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        { memberScreenName: "alice", action: "add", outcome: "added" },
        { memberScreenName: "bob", action: "add", outcome: "already-member" },
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
      results: [{ memberScreenName: "alice", action: "add", outcome: "added" }],
    });
    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [{ memberScreenName: "alice", action: "remove", outcome: "removed" }],
    });

    const row = await t.run((ctx) =>
      ctx.db
        .query("members")
        .withIndex("by_list_member", (q) =>
          q.eq("listId", "L1").eq("memberScreenName", "alice"),
        )
        .unique(),
    );
    expect(row).toMatchObject({ present: false, source: "extension" });

    const events = await t.run((ctx) => ctx.db.query("events").collect());
    expect(events).toHaveLength(2); // add + remove both logged
  });

  test('does NOT touch snapshot on "failed" / "rate-limited" / "protected" but still appends events', async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [
        { memberScreenName: "carol", action: "add", outcome: "failed" },
        { memberScreenName: "dave", action: "add", outcome: "rate-limited" },
        { memberScreenName: "erin", action: "add", outcome: "protected" },
      ],
    });

    const { members, events } = await t.run(async (ctx) => ({
      members: await ctx.db.query("members").collect(),
      events: await ctx.db.query("events").collect(),
    }));

    expect(members).toHaveLength(0); // snapshot untouched
    expect(events).toHaveLength(3); // every outcome logged
    expect(events.map((e) => e.outcome).sort()).toEqual([
      "failed",
      "protected",
      "rate-limited",
    ]);
  });
});

describe("reconcileAuthor", () => {
  test("mirrors X's truth: a List dropped from listIds flips present:true -> false", async () => {
    const t = convexTest(schema, modules);

    // Catalog two Owner-owned Lists.
    await t.mutation(api.membership.reconcileCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
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
});

describe("listsContaining", () => {
  test("returns rows for a screenName with correct present + ownerUserId", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.recordAssign, {
      deviceKey: DEVICE_KEY,
      owner,
      list,
      results: [{ memberScreenName: "alice", action: "add", outcome: "added" }],
    });

    const out = await t.query(api.membership.listsContaining, {
      deviceKey: DEVICE_KEY,
      screenName: "alice",
    });

    expect(out).toEqual([
      { listId: "L1", ownerUserId: "100", present: true, lastSeenAt: T0 },
    ]);
  });

  test("skips snapshot rows whose List is unknown (join miss)", async () => {
    const t = convexTest(schema, modules);

    // Snapshot row inserted directly with no matching list row.
    await t.run((ctx) =>
      ctx.db.insert("members", {
        listId: "orphan",
        memberScreenName: "ghost",
        present: true,
        source: "x-seed",
        addedAt: T0,
        lastSeenAt: T0,
      }),
    );

    const out = await t.query(api.membership.listsContaining, {
      deviceKey: DEVICE_KEY,
      screenName: "ghost",
    });
    expect(out).toEqual([]);
  });
});

describe("catalog", () => {
  test("groups Lists under their Owner", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.membership.reconcileCatalog, {
      deviceKey: DEVICE_KEY,
      owner,
      lists: [
        { listId: "L1", name: "Builders" },
        { listId: "L2", name: "Friends" },
      ],
    });
    await t.mutation(api.membership.reconcileCatalog, {
      deviceKey: DEVICE_KEY,
      owner: otherOwner,
      lists: [{ listId: "L3", name: "Alt list" }],
    });

    const out = await t.query(api.membership.catalog, { deviceKey: DEVICE_KEY });

    const byOwner = Object.fromEntries(
      out.map((g) => [g.owner.userId, g.lists.map((l) => l.listId).sort()]),
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
          listIds: ["L1"],
        }),
    },
    {
      name: "reconcileCatalog",
      run: (key) =>
        convexTest(schema, modules).mutation(api.membership.reconcileCatalog, {
          deviceKey: key,
          owner,
          lists: [{ listId: "L1", name: "Builders" }],
        }),
    },
    {
      name: "listsContaining",
      run: (key) =>
        convexTest(schema, modules).query(api.membership.listsContaining, {
          deviceKey: key,
          screenName: "alice",
        }),
    },
    {
      name: "catalog",
      run: (key) =>
        convexTest(schema, modules).query(api.membership.catalog, { deviceKey: key }),
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
