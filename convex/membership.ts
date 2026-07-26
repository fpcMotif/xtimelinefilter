import { getConvexSize, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertDeviceKey } from "./lib/auth";

/** Worst-case mutations stay below Convex's 1,000 concurrent-I/O function limit. */
export const MAX_OWNERS = 32;
export const MAX_ACTIVE_LISTS = 384;
export const MAX_ASSIGN_RESULTS = 256;
export const MAX_PERSISTED_STRING_BYTES = 256;

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

type DbCtx = MutationCtx | QueryCtx;
type ActiveCatalog = Array<{ owner: Doc<"accounts">; lists: Doc<"lists">[] }>;
type MembershipFact = { present: boolean };
type AssignmentResult = {
  action: "add" | "remove";
  outcome: string;
  evidence?: "server-response" | "ui-state";
};

const generationOf = (row: { catalogGeneration?: number }): number => row.catalogGeneration ?? 0;
const observationOf = (row: { observedAt?: number }): number => row.observedAt ?? 0;

/** Only action/outcome pairs that prove a state may affect cached facts. */
function membershipFact(result: AssignmentResult): MembershipFact | null {
  if (result.evidence !== "server-response") return null;
  if (
    result.action === "add" &&
    (result.outcome === "added" || result.outcome === "already-member")
  ) {
    return { present: true };
  }
  if (
    result.action === "remove" &&
    (result.outcome === "removed" || result.outcome === "already-absent")
  ) {
    return { present: false };
  }
  return null;
}

function isCurrentListForOwner(
  list: Doc<"lists"> | null,
  ownerState: OwnerState,
  ownerUserId: string,
): boolean {
  return (
    list !== null &&
    list.ownerUserId === ownerUserId &&
    generationOf(list) === ownerState.catalogGeneration
  );
}

function capacityError(subject: "Owners" | "active Lists" | "results", limit: number): Error {
  return new Error(`Mirror capacity exceeded: at most ${limit} ${subject}`);
}

function assertPersistedString(field: string, value: string | undefined): void {
  if (value !== undefined && getConvexSize(value) > MAX_PERSISTED_STRING_BYTES) {
    throw new Error(
      `Mirror data rejected: ${field} exceeds ${MAX_PERSISTED_STRING_BYTES}-byte limit`,
    );
  }
}

function assertPersistedOwner(owner: { userId: string; screenName: string }): void {
  assertPersistedString("owner.userId", owner.userId);
  assertPersistedString("owner.screenName", owner.screenName);
}

function assertPersistedList(list: { listId: string; name: string }): void {
  assertPersistedString("list.listId", list.listId);
  assertPersistedString("list.name", list.name);
}

const findOwner = (ctx: DbCtx, userId: string): Promise<Doc<"accounts"> | null> =>
  ctx.db
    .query("accounts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();

async function activeOwners(ctx: DbCtx): Promise<Doc<"accounts">[]> {
  const owners = await ctx.db.query("accounts").take(MAX_OWNERS + 1);
  if (owners.length > MAX_OWNERS) throw capacityError("Owners", MAX_OWNERS);
  return owners;
}

/**
 * Read one Owner's live generation. Generation zero needs two index reads:
 * legacy rows omit the optional field while newer zero-generation rows store it.
 */
async function currentListsForOwner(
  ctx: DbCtx,
  owner: Pick<Doc<"accounts">, "userId" | "catalogGeneration">,
  limit: number,
): Promise<Doc<"lists">[]> {
  const generation = generationOf(owner);
  if (generation !== 0) {
    const lists = await ctx.db
      .query("lists")
      .withIndex("by_owner_generation", (q) =>
        q.eq("ownerUserId", owner.userId).eq("catalogGeneration", generation),
      )
      .take(limit + 1);
    if (lists.length > limit) throw capacityError("active Lists", MAX_ACTIVE_LISTS);
    return lists;
  }

  const legacy = await ctx.db
    .query("lists")
    .withIndex("by_owner_generation", (q) =>
      q.eq("ownerUserId", owner.userId).eq("catalogGeneration", undefined),
    )
    .take(limit + 1);
  if (legacy.length > limit) throw capacityError("active Lists", MAX_ACTIVE_LISTS);

  const explicit = await ctx.db
    .query("lists")
    .withIndex("by_owner_generation", (q) =>
      q.eq("ownerUserId", owner.userId).eq("catalogGeneration", 0),
    )
    .take(limit - legacy.length + 1);
  if (legacy.length + explicit.length > limit) {
    throw capacityError("active Lists", MAX_ACTIVE_LISTS);
  }
  return [...legacy, ...explicit];
}

/** Reads the entire live catalog with a hard aggregate bound; never partial. */
async function activeCatalog(ctx: DbCtx): Promise<ActiveCatalog> {
  const owners = await activeOwners(ctx);
  const catalog: ActiveCatalog = [];
  let remaining = MAX_ACTIVE_LISTS;
  for (const owner of owners) {
    const lists = await currentListsForOwner(ctx, owner, remaining);
    remaining -= lists.length;
    catalog.push({ owner, lists });
  }
  return catalog;
}

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
    const owners = await activeOwners(ctx);
    if (owners.length >= MAX_OWNERS) throw capacityError("Owners", MAX_OWNERS);
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
  ownerState: OwnerState,
  ownerUserId: string,
): Promise<void> {
  const existing = await ctx.db
    .query("lists")
    .withIndex("by_listId", (q) => q.eq("listId", list.listId))
    .unique();
  const alreadyActiveForOwner = isCurrentListForOwner(existing, ownerState, ownerUserId);
  if (!alreadyActiveForOwner) {
    const catalog = await activeCatalog(ctx);
    const activeAnywhere = catalog.some(({ lists }) =>
      lists.some((current) => current.listId === list.listId),
    );
    if (!activeAnywhere) {
      const count = catalog.reduce((total, group) => total + group.lists.length, 0);
      if (count >= MAX_ACTIVE_LISTS) throw capacityError("active Lists", MAX_ACTIVE_LISTS);
    }
  }
  if (existing === null) {
    await ctx.db.insert("lists", {
      listId: list.listId,
      name: list.name,
      ownerUserId,
      catalogGeneration: ownerState.catalogGeneration,
    });
  } else {
    await ctx.db.patch(existing._id, {
      ownerUserId,
      catalogGeneration: ownerState.catalogGeneration,
    });
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
        evidence: v.optional(v.union(v.literal("server-response"), v.literal("ui-state"))),
        observedAt: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    if (args.results.length > MAX_ASSIGN_RESULTS) {
      throw capacityError("results", MAX_ASSIGN_RESULTS);
    }
    assertPersistedOwner(args.owner);
    assertPersistedList(args.list);
    for (const result of args.results) {
      assertPersistedString("result.memberScreenName", result.memberScreenName);
      assertPersistedString("result.memberUserId", result.memberUserId);
      assertPersistedString("result.memberIdentity", result.memberIdentity);
      assertPersistedString("result.outcome", result.outcome);
    }
    const now = Date.now();

    const ownerState = await upsertOwner(ctx, args.owner, now, args.ownerObservedAt ?? 0);
    const provenResults = args.results.filter((result) => membershipFact(result) !== null);
    const currentProofs = provenResults.filter(
      (result) =>
        ownerState.catalogObservedAt === undefined ||
        (result.observedAt ?? 0) >= ownerState.catalogObservedAt,
    );
    let listAllowsSnapshots = currentProofs.length > 0;
    if (currentProofs.length > 0) {
      await proveListCurrent(ctx, args.list, ownerState, args.owner.userId);
      const catalogFactObservedAt = Math.max(
        ownerState.catalogFactObservedAt ?? 0,
        ...currentProofs.map((result) => result.observedAt ?? 0),
      );
      if (catalogFactObservedAt !== ownerState.catalogFactObservedAt) {
        await ctx.db.patch(ownerState.id, { catalogFactObservedAt });
      }
    } else if (provenResults.some((result) => result.memberIdentity)) {
      // A delayed action cannot revive a List that a newer full catalog removed.
      // It may still update membership for a List that remains current.
      const currentList = await ctx.db
        .query("lists")
        .withIndex("by_listId", (q) => q.eq("listId", args.list.listId))
        .unique();
      listAllowsSnapshots = isCurrentListForOwner(currentList, ownerState, args.owner.userId);
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
        ...(result.evidence !== undefined ? { evidence: result.evidence } : {}),
        observedAt,
        at: now,
      });

      // Missing identity is audit-only. A handle can never key cached state.
      if (result.memberIdentity === undefined || result.memberIdentity === "") continue;

      // Snapshot mutates only from a direction-aware fact for a current List.
      if (!listAllowsSnapshots) continue;
      const fact = membershipFact(result);
      if (fact !== null) {
        await setSnapshot(ctx, {
          listId: args.list.listId,
          memberScreenName: result.memberScreenName,
          memberUserId: result.memberUserId,
          memberIdentity: result.memberIdentity,
          present: fact.present,
          source: "extension",
          observedAt,
          now,
        });
      }
      // Mismatches and failures: event only.
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
    if (args.listIds.length > MAX_ACTIVE_LISTS) {
      throw capacityError("active Lists", MAX_ACTIVE_LISTS);
    }
    assertPersistedOwner(args.owner);
    assertPersistedString("screenName", args.screenName);
    assertPersistedString("memberIdentity", args.memberIdentity);
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
    // upsertOwner and activeCatalog share this transaction. The active catalog
    // must contain the Owner just returned; a violation is corruption, not a
    // valid no-op.
    const ownedLists = (await activeCatalog(ctx)).find(
      ({ owner }) => owner._id === ownerState.id,
    )!.lists;

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
    if (args.lists.length > MAX_ACTIVE_LISTS) {
      throw capacityError("active Lists", MAX_ACTIVE_LISTS);
    }
    assertPersistedOwner(args.owner);
    for (const list of args.lists) assertPersistedList(list);
    if (new Set(args.lists.map((list) => list.listId)).size !== args.lists.length) {
      throw new Error("Mirror catalog rejected: List IDs must be unique");
    }
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

    const active = await activeCatalog(ctx);
    const incomingIds = new Set(args.lists.map((list) => list.listId));
    const retained = active
      .filter(({ owner }) => owner.userId !== args.owner.userId)
      .flatMap(({ lists }) => lists)
      .filter((list) => !incomingIds.has(list.listId));
    if (retained.length + args.lists.length > MAX_ACTIVE_LISTS) {
      throw capacityError("active Lists", MAX_ACTIVE_LISTS);
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
    // Old Lists and snapshots stay inert and can be reused if a List returns;
    // audit events remain append-only. Only the active working set is bounded.

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

    const currentLists = (await activeCatalog(ctx)).flatMap(({ lists }) => lists);

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

    return (await activeCatalog(ctx)).map(({ owner, lists }) => ({
      owner: { userId: owner.userId, screenName: owner.screenName },
      lists: lists.map((l) => ({
        listId: l.listId,
        name: l.name,
        isPrivate: l.isPrivate,
        memberCount: l.memberCount,
        lastReconciledAt: l.lastReconciledAt,
      })),
      lastReconciledAt: owner.catalogObservedAt,
    }));
  },
});
