import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { assertDeviceKey } from "./lib/auth";

const ownerValidator = v.object({
  userId: v.string(),
  screenName: v.string(),
});

const listValidator = v.object({
  listId: v.string(),
  name: v.string(),
  isPrivate: v.optional(v.boolean()),
  memberCount: v.optional(v.number()),
});

// Upsert an Owner into `accounts`, bumping lastSeenAt.
async function upsertOwner(
  ctx: MutationCtx,
  owner: { userId: string; screenName: string },
  now: number,
): Promise<void> {
  const existing = await ctx.db
    .query("accounts")
    .withIndex("by_userId", (q) => q.eq("userId", owner.userId))
    .unique();
  if (existing === null) {
    await ctx.db.insert("accounts", {
      userId: owner.userId,
      screenName: owner.screenName,
      firstSeenAt: now,
      lastSeenAt: now,
    });
  } else {
    await ctx.db.patch(existing._id, {
      // screenName is best-effort and may be "" pre-hydration (see Owner in
      // membership-store/types.ts) — never clobber a stored real handle with it.
      ...(owner.screenName !== "" ? { screenName: owner.screenName } : {}),
      lastSeenAt: now,
    });
  }
}

// Upsert a List into `lists`, owned by ownerUserId.
async function upsertList(
  ctx: MutationCtx,
  list: {
    listId: string;
    name: string;
    isPrivate?: boolean;
    memberCount?: number;
  },
  ownerUserId: string,
  now: number,
  reconciled: boolean,
): Promise<void> {
  const existing = await ctx.db
    .query("lists")
    .withIndex("by_listId", (q) => q.eq("listId", list.listId))
    .unique();
  const fields = {
    name: list.name,
    ownerUserId,
    // Spread these only when supplied: db.patch treats an explicit `undefined`
    // as a field delete, so an unconditional `isPrivate: list.isPrivate` on a
    // caller that omits it (e.g. recordAssign) would strip metadata a prior
    // reconcileCatalog stored. Same conditional-spread idiom as lastReconciledAt
    // below and memberUserId in setSnapshot.
    ...(list.isPrivate !== undefined ? { isPrivate: list.isPrivate } : {}),
    ...(list.memberCount !== undefined ? { memberCount: list.memberCount } : {}),
    ...(reconciled ? { lastReconciledAt: now } : {}),
  };
  if (existing === null) {
    await ctx.db.insert("lists", { listId: list.listId, ...fields });
  } else {
    await ctx.db.patch(existing._id, fields);
  }
}

// Set the snapshot presence for (listId, screenName), upserting the row.
async function setSnapshot(
  ctx: MutationCtx,
  args: {
    listId: string;
    memberScreenName: string;
    memberUserId?: string;
    present: boolean;
    source: "x-seed" | "extension";
    now: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("members")
    .withIndex("by_list_member", (q) =>
      q.eq("listId", args.listId).eq("memberScreenName", args.memberScreenName),
    )
    .unique();
  if (existing === null) {
    await ctx.db.insert("members", {
      listId: args.listId,
      memberScreenName: args.memberScreenName,
      memberUserId: args.memberUserId,
      present: args.present,
      source: args.source,
      addedAt: args.now,
      lastSeenAt: args.now,
    });
  } else {
    await ctx.db.patch(existing._id, {
      present: args.present,
      source: args.source,
      lastSeenAt: args.now,
      ...(args.memberUserId !== undefined ? { memberUserId: args.memberUserId } : {}),
    });
  }
}

export const recordAssign = mutation({
  args: {
    deviceKey: v.string(),
    owner: ownerValidator,
    list: listValidator,
    results: v.array(
      v.object({
        memberScreenName: v.string(),
        memberUserId: v.optional(v.string()),
        action: v.union(v.literal("add"), v.literal("remove")),
        outcome: v.string(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    const now = Date.now();

    await upsertOwner(ctx, args.owner, now);
    await upsertList(ctx, args.list, args.owner.userId, now, false);

    for (const result of args.results) {
      // Audit log: always one event per result, every outcome.
      await ctx.db.insert("events", {
        listId: args.list.listId,
        ownerUserId: args.owner.userId,
        memberScreenName: result.memberScreenName,
        memberUserId: result.memberUserId,
        action: result.action,
        outcome: result.outcome,
        at: now,
      });

      // Snapshot mutates only on a real membership change.
      if (result.outcome === "added" || result.outcome === "already-member") {
        await setSnapshot(ctx, {
          listId: args.list.listId,
          memberScreenName: result.memberScreenName,
          memberUserId: result.memberUserId,
          present: true,
          source: "extension",
          now,
        });
      } else if (result.outcome === "removed") {
        await setSnapshot(ctx, {
          listId: args.list.listId,
          memberScreenName: result.memberScreenName,
          memberUserId: result.memberUserId,
          present: false,
          source: "extension",
          now,
        });
      }
      // protected | rate-limited | failed | anything else: event only.
    }

    return null;
  },
});

export const reconcileAuthor = mutation({
  args: {
    deviceKey: v.string(),
    owner: ownerValidator,
    screenName: v.string(),
    listIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    const now = Date.now();

    await upsertOwner(ctx, args.owner, now);

    const present = new Set(args.listIds);
    const ownedLists = await ctx.db
      .query("lists")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.owner.userId))
      .collect();

    for (const list of ownedLists) {
      await setSnapshot(ctx, {
        listId: list.listId,
        memberScreenName: args.screenName,
        present: present.has(list.listId),
        source: "x-seed",
        now,
      });
    }

    return null;
  },
});

export const reconcileCatalog = mutation({
  args: {
    deviceKey: v.string(),
    owner: ownerValidator,
    lists: v.array(listValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    const now = Date.now();

    await upsertOwner(ctx, args.owner, now);
    for (const list of args.lists) {
      await upsertList(ctx, list, args.owner.userId, now, true);
    }

    return null;
  },
});

export const listsContaining = query({
  args: {
    deviceKey: v.string(),
    screenName: v.string(),
  },
  returns: v.array(
    v.object({
      listId: v.string(),
      ownerUserId: v.string(),
      present: v.boolean(),
      lastSeenAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);

    const rows = await ctx.db
      .query("members")
      .withIndex("by_member", (q) => q.eq("memberScreenName", args.screenName))
      .collect();

    // Resolve each row's List concurrently rather than awaiting one round-trip
    // per row in series — this runs on every author hover, so the serial N+1
    // shape was the avoidable cost.
    const lists = await Promise.all(
      rows.map((row) =>
        ctx.db
          .query("lists")
          .withIndex("by_listId", (q) => q.eq("listId", row.listId))
          .unique(),
      ),
    );

    const out: Array<{
      listId: string;
      ownerUserId: string;
      present: boolean;
      lastSeenAt: number;
    }> = [];
    rows.forEach((row, i) => {
      const list = lists[i];
      if (!list) return; // snapshot row for an unknown List: skip the join
      out.push({
        listId: row.listId,
        ownerUserId: list.ownerUserId,
        present: row.present,
        lastSeenAt: row.lastSeenAt,
      });
    });
    return out;
  },
});

export const catalog = query({
  args: {
    deviceKey: v.string(),
  },
  returns: v.array(
    v.object({
      owner: v.object({ userId: v.string(), screenName: v.string() }),
      lists: v.array(
        v.object({
          listId: v.string(),
          name: v.string(),
          isPrivate: v.optional(v.boolean()),
          memberCount: v.optional(v.number()),
          lastReconciledAt: v.optional(v.number()),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);

    const owners = await ctx.db.query("accounts").collect();
    // One owned-Lists query per Owner, fanned out concurrently instead of serially.
    return Promise.all(
      owners.map(async (owner) => {
        const lists = await ctx.db
          .query("lists")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", owner.userId))
          .collect();
        return {
          owner: { userId: owner.userId, screenName: owner.screenName },
          lists: lists.map((l) => ({
            listId: l.listId,
            name: l.name,
            isPrivate: l.isPrivate,
            memberCount: l.memberCount,
            lastReconciledAt: l.lastReconciledAt,
          })),
        };
      }),
    );
  },
});
