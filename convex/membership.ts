import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
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

interface OwnerState {
  id: Id<"accounts">;
  catalogGeneration: number;
  catalogObservedAt: number | undefined;
  catalogFactObservedAt: number | undefined;
}

const generationOf = (row: { catalogGeneration?: number }): number => row.catalogGeneration ?? 0;
const observationOf = (row: { observedAt?: number }): number => row.observedAt ?? 0;

const findOwner = (ctx: MutationCtx, userId: string): Promise<Doc<"accounts"> | null> =>
  ctx.db
    .query("accounts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

// Upsert an Owner without letting an older fact revert its display profile.
async function upsertOwner(
  ctx: MutationCtx,
  owner: { userId: string; screenName: string },
  now: number,
  observedAt: number,
  known?: Doc<"accounts"> | null,
): Promise<OwnerState> {
  const existing = known === undefined ? await findOwner(ctx, owner.userId) : known;
  if (existing === null) {
    const id = await ctx.db.insert("accounts", {
      userId: owner.userId,
      screenName: owner.screenName,
      firstSeenAt: now,
      lastSeenAt: now,
      catalogGeneration: 0,
      profileObservedAt: observedAt,
    });
    return {
      id,
      catalogGeneration: 0,
      catalogObservedAt: undefined,
      catalogFactObservedAt: undefined,
    };
  } else {
    const catalogGeneration = generationOf(existing);
    const acceptsProfile = observedAt >= (existing.profileObservedAt ?? 0);
    await ctx.db.patch(existing._id, {
      // Identity is userId. A transient account read may have no profile link;
      // retain the last useful display handle rather than replacing it with "".
      ...(acceptsProfile && owner.screenName ? { screenName: owner.screenName } : {}),
      ...(acceptsProfile ? { lastSeenAt: now, profileObservedAt: observedAt } : {}),
      catalogGeneration,
    });
    return {
      id: existing._id,
      catalogGeneration,
      catalogObservedAt: existing.catalogObservedAt,
      catalogFactObservedAt: existing.catalogFactObservedAt,
    };
  }
}

// A complete catalog owns List display metadata.
async function replaceListMetadata(
  ctx: MutationCtx,
  list: {
    listId: string;
    name: string;
    isPrivate?: boolean;
    memberCount?: number;
  },
  ownerUserId: string,
  now: number,
  catalogGeneration: number,
): Promise<void> {
  const existing = await ctx.db
    .query("lists")
    .withIndex("by_listId", (q) => q.eq("listId", list.listId))
    .unique();
  const fields = {
    name: list.name,
    ownerUserId,
    catalogGeneration,
    // Spread these only when supplied: db.patch treats explicit `undefined` as
    // deletion. A sparse complete answer must not strip known metadata.
    ...(list.isPrivate !== undefined ? { isPrivate: list.isPrivate } : {}),
    ...(list.memberCount !== undefined ? { memberCount: list.memberCount } : {}),
    lastReconciledAt: now,
  };
  if (existing === null) {
    await ctx.db.insert("lists", { listId: list.listId, ...fields });
  } else {
    await ctx.db.patch(existing._id, fields);
  }
}

// A direct action proves existence only. It cannot overwrite catalog metadata.
async function proveListCurrent(
  ctx: MutationCtx,
  list: { listId: string; name: string },
  ownerUserId: string,
  catalogGeneration: number,
): Promise<void> {
  const existing = await ctx.db
    .query("lists")
    .withIndex("by_listId", (q) => q.eq("listId", list.listId))
    .unique();
  if (existing === null) {
    await ctx.db.insert("lists", {
      listId: list.listId,
      name: list.name,
      ownerUserId,
      catalogGeneration,
    });
  } else {
    await ctx.db.patch(existing._id, { ownerUserId, catalogGeneration });
  }
}

// Set snapshot presence for (List, stable person identity), upserting the row.
async function setSnapshot(
  ctx: MutationCtx,
  args: {
    listId: string;
    memberScreenName: string;
    memberUserId?: string;
    memberIdentity: string;
    present: boolean;
    source: "x-seed" | "extension";
    observedAt: number;
    now: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("members")
    .withIndex("by_list_member_identity", (q) =>
      q.eq("listId", args.listId).eq("memberIdentity", args.memberIdentity),
    )
    .unique();
  if (existing !== null) {
    const existingObservedAt = observationOf(existing);
    if (args.observedAt < existingObservedAt) return;
    if (
      args.observedAt === existingObservedAt &&
      existing.source === "extension" &&
      args.source === "x-seed"
    ) {
      return;
    }
  }
  if (existing === null) {
    await ctx.db.insert("members", {
      listId: args.listId,
      memberScreenName: args.memberScreenName,
      memberUserId: args.memberUserId,
      memberIdentity: args.memberIdentity,
      present: args.present,
      source: args.source,
      observedAt: args.observedAt,
      addedAt: args.now,
      lastSeenAt: args.now,
    });
  } else {
    await ctx.db.patch(existing._id, {
      memberScreenName: args.memberScreenName,
      present: args.present,
      source: args.source,
      observedAt: args.observedAt,
      lastSeenAt: args.now,
      ...(args.memberUserId !== undefined ? { memberUserId: args.memberUserId } : {}),
    });
  }
}

export const recordAssign = mutation({
  args: {
    deviceKey: v.string(),
    owner: ownerValidator,
    ownerObservedAt: v.optional(v.number()),
    list: listValidator,
    results: v.array(
      v.object({
        memberScreenName: v.string(),
        memberUserId: v.optional(v.string()),
        memberIdentity: v.optional(v.string()),
        action: v.union(v.literal("add"), v.literal("remove")),
        outcome: v.string(),
        observedAt: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    const now = Date.now();

    const ownerState = await upsertOwner(ctx, args.owner, now, args.ownerObservedAt ?? 0);
    const provenResults = args.results.filter(
      (result) =>
        result.outcome === "added" ||
        result.outcome === "already-member" ||
        result.outcome === "removed",
    );
    const currentProofs = provenResults.filter(
      (result) =>
        ownerState.catalogObservedAt === undefined ||
        (result.observedAt ?? 0) >= ownerState.catalogObservedAt,
    );
    if (currentProofs.length > 0) {
      await proveListCurrent(ctx, args.list, args.owner.userId, ownerState.catalogGeneration);
      const catalogFactObservedAt = Math.max(
        ownerState.catalogFactObservedAt ?? 0,
        ...currentProofs.map((result) => result.observedAt ?? 0),
      );
      if (catalogFactObservedAt !== ownerState.catalogFactObservedAt) {
        await ctx.db.patch(ownerState.id, { catalogFactObservedAt });
      }
    }

    for (const result of args.results) {
      const observedAt = result.observedAt ?? 0;
      // Audit log: always one event per result, every outcome.
      await ctx.db.insert("events", {
        listId: args.list.listId,
        ownerUserId: args.owner.userId,
        memberScreenName: result.memberScreenName,
        memberUserId: result.memberUserId,
        ...(result.memberIdentity !== undefined ? { memberIdentity: result.memberIdentity } : {}),
        action: result.action,
        outcome: result.outcome,
        observedAt,
        at: now,
      });

      // Missing identity is audit-only. A handle can never key cached state.
      if (result.memberIdentity === undefined || result.memberIdentity === "") continue;

      // Snapshot mutates only on a real membership change.
      if (result.outcome === "added" || result.outcome === "already-member") {
        await setSnapshot(ctx, {
          listId: args.list.listId,
          memberScreenName: result.memberScreenName,
          memberUserId: result.memberUserId,
          memberIdentity: result.memberIdentity,
          present: true,
          source: "extension",
          observedAt,
          now,
        });
      } else if (result.outcome === "removed") {
        await setSnapshot(ctx, {
          listId: args.list.listId,
          memberScreenName: result.memberScreenName,
          memberUserId: result.memberUserId,
          memberIdentity: result.memberIdentity,
          present: false,
          source: "extension",
          observedAt,
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
    memberIdentity: v.optional(v.string()),
    observedAt: v.optional(v.number()),
    ownerObservedAt: v.optional(v.number()),
    listIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    const now = Date.now();

    const observedAt = args.observedAt ?? 0;
    const existingOwner = await findOwner(ctx, args.owner.userId);
    if (
      existingOwner?.catalogObservedAt !== undefined &&
      observedAt < existingOwner.catalogObservedAt
    ) {
      return null;
    }
    const ownerState = await upsertOwner(
      ctx,
      args.owner,
      now,
      args.ownerObservedAt ?? observedAt,
      existingOwner,
    );
    if (args.memberIdentity === undefined || args.memberIdentity === "") return null;

    const present = new Set(args.listIds);
    // Generation 0 includes legacy rows where the optional field is absent.
    const ownedLists =
      ownerState.catalogGeneration === 0
        ? (
            await ctx.db
              .query("lists")
              .withIndex("by_owner", (q) => q.eq("ownerUserId", args.owner.userId))
              .collect()
          ).filter((list) => generationOf(list) === 0)
        : await ctx.db
            .query("lists")
            .withIndex("by_owner_generation", (q) =>
              q
                .eq("ownerUserId", args.owner.userId)
                .eq("catalogGeneration", ownerState.catalogGeneration),
            )
            .collect();

    for (const list of ownedLists) {
      await setSnapshot(ctx, {
        listId: list.listId,
        memberScreenName: args.screenName,
        memberIdentity: args.memberIdentity,
        present: present.has(list.listId),
        source: "x-seed",
        observedAt,
        now,
      });
    }

    return null;
  },
});

export const replaceCatalog = mutation({
  args: {
    deviceKey: v.string(),
    owner: ownerValidator,
    observedAt: v.number(),
    ownerObservedAt: v.optional(v.number()),
    lists: v.array(listValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    const now = Date.now();

    const existingOwner = await findOwner(ctx, args.owner.userId);
    if (
      (existingOwner?.catalogObservedAt !== undefined &&
        args.observedAt < existingOwner.catalogObservedAt) ||
      (existingOwner?.catalogFactObservedAt !== undefined &&
        args.observedAt <= existingOwner.catalogFactObservedAt)
    ) {
      return null;
    }

    const ownerState = await upsertOwner(
      ctx,
      args.owner,
      now,
      args.ownerObservedAt ?? args.observedAt,
      existingOwner,
    );

    // Equal fetch-start times are indistinguishable at millisecond precision.
    // Complete-catalog ties use last arrival; equal direct facts win above.

    const catalogGeneration = ownerState.catalogGeneration + 1;
    await ctx.db.patch(ownerState.id, {
      catalogGeneration,
      catalogObservedAt: args.observedAt,
    });
    for (const list of args.lists) {
      await replaceListMetadata(ctx, list, args.owner.userId, now, catalogGeneration);
    }

    // ownerships.json is read through its terminal cursor before this mutation.
    // Advancing one Owner generation replaces the complete catalog atomically.
    // Old Lists and snapshots stay inert for a later bounded garbage collector;
    // audit events remain append-only.

    return null;
  },
});

export const listsContaining = query({
  args: {
    deviceKey: v.string(),
    memberIdentity: v.string(),
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

    const owners = await ctx.db.query("accounts").collect();
    const currentLists = (
      await Promise.all(
        owners.map(async (owner) => {
          const catalogGeneration = generationOf(owner);
          // Generation 0 includes legacy rows where the optional field is absent.
          return catalogGeneration === 0
            ? (
                await ctx.db
                  .query("lists")
                  .withIndex("by_owner", (q) => q.eq("ownerUserId", owner.userId))
                  .collect()
              ).filter((list) => generationOf(list) === 0)
            : ctx.db
                .query("lists")
                .withIndex("by_owner_generation", (q) =>
                  q.eq("ownerUserId", owner.userId).eq("catalogGeneration", catalogGeneration),
                )
                .collect();
        }),
      )
    ).flat();

    // Query one exact snapshot per current List. Cost follows the live catalog,
    // never the inert membership history left by logical replacement.
    const rows = await Promise.all(
      currentLists.map((list) =>
        ctx.db
          .query("members")
          .withIndex("by_list_member_identity", (q) =>
            q.eq("listId", list.listId).eq("memberIdentity", args.memberIdentity),
          )
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
      const list = currentLists[i];
      if (!row || !list) return;
      out.push({
        listId: row.listId,
        ownerUserId: list.ownerUserId,
        present: row.present,
        lastSeenAt: row.observedAt ?? row.lastSeenAt,
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
      lastReconciledAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);

    const owners = await ctx.db.query("accounts").collect();
    // One owned-Lists query per Owner, fanned out concurrently instead of serially.
    return Promise.all(
      owners.map(async (owner) => {
        const catalogGeneration = generationOf(owner);
        // Generation 0 includes legacy rows where the optional field is absent.
        const currentLists =
          catalogGeneration === 0
            ? (
                await ctx.db
                  .query("lists")
                  .withIndex("by_owner", (q) => q.eq("ownerUserId", owner.userId))
                  .collect()
              ).filter((list) => generationOf(list) === 0)
            : await ctx.db
                .query("lists")
                .withIndex("by_owner_generation", (q) =>
                  q.eq("ownerUserId", owner.userId).eq("catalogGeneration", catalogGeneration),
                )
                .collect();
        return {
          owner: { userId: owner.userId, screenName: owner.screenName },
          lists: currentLists.map((l) => ({
            listId: l.listId,
            name: l.name,
            isPrivate: l.isPrivate,
            memberCount: l.memberCount,
            lastReconciledAt: l.lastReconciledAt,
          })),
          lastReconciledAt: owner.catalogObservedAt,
        };
      }),
    );
  },
});
