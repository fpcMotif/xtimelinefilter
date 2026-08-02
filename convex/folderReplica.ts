import { getConvexSize, v } from "convex/values";

import { mutation as convexMutation, query } from "./_generated/server";
import { replicaChangeValidator, replicaMutationValidator } from "./folderReplicaValidators";
import { assertDeviceKey } from "./lib/auth";

/** Bounds a transaction well below Convex document, I/O, and response limits. */
export const MAX_REPLICA_MUTATIONS = 256;
export const MAX_REPLICA_PAGE_SIZE = 128;
export const MAX_REPLICA_MUTATION_BYTES = 64_000;

const MAX_OPERATION_ID_BYTES = 128;
const MAX_KEY_BYTES = 512;
const MAX_IDENTIFIER_BYTES = 256;
const MAX_FOLDER_NAME_BYTES = 400;
const MAX_FOLDER_NAME_CODE_POINTS = 100;
const MAX_POST_TEXT_BYTES = 100_000;
const MAX_NOTE_BYTES = 8_000;
const MAX_TAG_BYTES = 192;
const MAX_URL_BYTES = 8_192;
const MAX_MEDIA = 8;
const MAX_TAGS = 32;
const MAX_ATOMIC_GROUP_SIZE = 200;

const replicaResultValidator = v.object({
  operationId: v.string(),
  status: v.union(v.literal("accepted"), v.literal("conflict")),
  revision: v.number(),
});

type SavedPostValue = {
  statusId: string;
  permalink: string | null;
  author?: { screenName: string; userId?: string };
  text?: string;
  media: Array<{ kind: "photo" | "video"; url?: string }>;
  postedAt?: string;
  capturedAt: number;
  note: string;
  tags: string[];
};

type ReplicaEntity =
  | {
      kind: "folder";
      key: string;
      folderId: string;
      value: {
        folderId: string;
        name: string;
        sortIndex: number;
        createdAt: number;
        updatedAt: number;
        deletedAt: number | null;
      } | null;
    }
  | {
      kind: "saved-post";
      key: string;
      statusId: string;
      value: SavedPostValue | null;
    }
  | {
      kind: "folder-membership";
      key: string;
      folderId: string;
      statusId: string;
      value: { folderId: string; statusId: string; addedAt: number } | null;
    }
  | {
      kind: "bookmark-evidence";
      key: string;
      statusId: string;
      xAccountId: string;
      value: {
        statusId: string;
        xAccountId: string;
        outcome: "confirmed" | "failed" | "skipped";
        observedAt: number;
      } | null;
    };

type ReplicaMutation = {
  operationId: string;
  baseRevision: number;
  atomicGroupId?: string;
  atomicGroupSize?: number;
  entity: ReplicaEntity;
};

function key(parts: readonly string[]): string {
  return JSON.stringify(parts);
}
function isTombstoned(entity: ReplicaEntity): boolean {
  return entity.value === null || (entity.kind === "folder" && entity.value.deletedAt !== null);
}

function assertString(field: string, value: string, maximum: number, allowEmpty = false): void {
  if (!allowEmpty && value.length === 0)
    throw new Error(`Replica data rejected: ${field} is empty`);
  if (getConvexSize(value) > maximum) {
    throw new Error(`Replica data rejected: ${field} exceeds ${maximum}-byte limit`);
  }
}

function assertCodePoints(field: string, value: string, maximum: number): void {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > maximum) {
      throw new Error(`Replica data rejected: ${field} exceeds ${maximum}-code-point limit`);
    }
  }
}

function assertTime(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Replica data rejected: ${field} must be a non-negative safe integer`);
  }
}

function assertRevision(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Replica data rejected: ${field} must be a non-negative safe integer`);
  }
}

function assertSavedPost(value: SavedPostValue, statusId: string): void {
  if (value.statusId !== statusId) {
    throw new Error(
      "Replica data rejected: saved-post value.statusId does not match entity statusId",
    );
  }
  assertString("saved-post.statusId", value.statusId, MAX_IDENTIFIER_BYTES);
  if (value.permalink !== null)
    assertString("saved-post.permalink", value.permalink, MAX_URL_BYTES);
  if (value.author) {
    assertString("saved-post.author.screenName", value.author.screenName, MAX_IDENTIFIER_BYTES);
    if (value.author.userId)
      assertString("saved-post.author.userId", value.author.userId, MAX_IDENTIFIER_BYTES);
  }
  if (value.text !== undefined)
    assertString("saved-post.text", value.text, MAX_POST_TEXT_BYTES, true);
  if (value.postedAt !== undefined)
    assertString("saved-post.postedAt", value.postedAt, MAX_IDENTIFIER_BYTES);
  if (value.media.length > MAX_MEDIA) {
    throw new Error(`Replica capacity exceeded: at most ${MAX_MEDIA} media items`);
  }
  for (const media of value.media) {
    if (media.url !== undefined) assertString("saved-post.media.url", media.url, MAX_URL_BYTES);
  }
  assertTime("saved-post.capturedAt", value.capturedAt);
  assertString("saved-post.note", value.note, MAX_NOTE_BYTES, true);
  if (value.tags.length > MAX_TAGS) {
    throw new Error(`Replica capacity exceeded: at most ${MAX_TAGS} tags`);
  }
  for (const tag of value.tags) assertString("saved-post.tags", tag, MAX_TAG_BYTES);
}

function assertEntity(entity: ReplicaEntity): void {
  assertString("entity.key", entity.key, MAX_KEY_BYTES);
  switch (entity.kind) {
    case "folder": {
      assertString("folderId", entity.folderId, MAX_IDENTIFIER_BYTES);
      if (entity.key !== key(["folder", entity.folderId])) {
        throw new Error("Replica data rejected: folder key does not match folderId");
      }
      if (entity.value === null) return;
      if (entity.value.folderId !== entity.folderId) {
        throw new Error(
          "Replica data rejected: folder value.folderId does not match entity folderId",
        );
      }
      assertString("folder.name", entity.value.name, MAX_FOLDER_NAME_BYTES);
      assertCodePoints("folder.name", entity.value.name, MAX_FOLDER_NAME_CODE_POINTS);
      assertRevision("folder.sortIndex", entity.value.sortIndex);
      assertTime("folder.createdAt", entity.value.createdAt);
      assertTime("folder.updatedAt", entity.value.updatedAt);
      if (entity.value.updatedAt < entity.value.createdAt) {
        throw new Error("Replica data rejected: folder.updatedAt precedes createdAt");
      }
      if (entity.value.deletedAt !== null) {
        assertTime("folder.deletedAt", entity.value.deletedAt);
        if (entity.value.deletedAt < entity.value.createdAt) {
          throw new Error("Replica data rejected: folder.deletedAt precedes createdAt");
        }
      }
      return;
    }
    case "saved-post": {
      assertString("statusId", entity.statusId, MAX_IDENTIFIER_BYTES);
      if (entity.key !== key(["saved-post", entity.statusId])) {
        throw new Error("Replica data rejected: saved-post key does not match statusId");
      }
      if (entity.value !== null) assertSavedPost(entity.value, entity.statusId);
      return;
    }
    case "folder-membership": {
      assertString("folderId", entity.folderId, MAX_IDENTIFIER_BYTES);
      assertString("statusId", entity.statusId, MAX_IDENTIFIER_BYTES);
      if (entity.key !== key(["folder-membership", entity.folderId, entity.statusId])) {
        throw new Error("Replica data rejected: folder-membership key does not match foreign keys");
      }
      if (entity.value === null) return;
      if (entity.value.folderId !== entity.folderId || entity.value.statusId !== entity.statusId) {
        throw new Error(
          "Replica data rejected: folder-membership value does not match foreign keys",
        );
      }
      assertTime("folder-membership.addedAt", entity.value.addedAt);
      return;
    }
    case "bookmark-evidence": {
      assertString("statusId", entity.statusId, MAX_IDENTIFIER_BYTES);
      assertString("xAccountId", entity.xAccountId, MAX_IDENTIFIER_BYTES);
      if (entity.key !== key(["bookmark-evidence", entity.statusId, entity.xAccountId])) {
        throw new Error("Replica data rejected: bookmark-evidence key does not match foreign keys");
      }
      if (entity.value === null) return;
      if (
        entity.value.statusId !== entity.statusId ||
        entity.value.xAccountId !== entity.xAccountId
      ) {
        throw new Error(
          "Replica data rejected: bookmark-evidence value does not match foreign keys",
        );
      }
      assertTime("bookmark-evidence.observedAt", entity.value.observedAt);
    }
  }
}

function assertBatch(mutations: readonly ReplicaMutation[]): void {
  if (mutations.length > MAX_REPLICA_MUTATIONS) {
    throw new Error(`Replica capacity exceeded: at most ${MAX_REPLICA_MUTATIONS} mutations`);
  }
  const operationIds = new Set<string>();
  const entityKeys = new Set<string>();
  const groups = new Map<string, { size: number; count: number }>();
  const closedGroups = new Set<string>();
  let activeGroupId: string | undefined;
  for (const replicaMutation of mutations) {
    assertString("operationId", replicaMutation.operationId, MAX_OPERATION_ID_BYTES);
    assertRevision("baseRevision", replicaMutation.baseRevision);
    if (getConvexSize(JSON.stringify(replicaMutation)) > MAX_REPLICA_MUTATION_BYTES) {
      throw new Error(
        `Replica data rejected: mutation exceeds ${MAX_REPLICA_MUTATION_BYTES}-byte limit`,
      );
    }
    assertEntity(replicaMutation.entity);
    if (operationIds.has(replicaMutation.operationId)) {
      throw new Error("Replica data rejected: duplicate operationId in batch");
    }
    if (entityKeys.has(replicaMutation.entity.key)) {
      throw new Error(
        "Replica data rejected: multiple mutations target the same entity in one batch",
      );
    }
    operationIds.add(replicaMutation.operationId);
    entityKeys.add(replicaMutation.entity.key);

    if (replicaMutation.atomicGroupId !== activeGroupId) {
      if (activeGroupId !== undefined) closedGroups.add(activeGroupId);
      activeGroupId = replicaMutation.atomicGroupId;
      if (activeGroupId !== undefined && closedGroups.has(activeGroupId)) {
        throw new Error("Replica data rejected: atomic group members must be contiguous");
      }
    }

    if (
      replicaMutation.atomicGroupId === undefined &&
      replicaMutation.atomicGroupSize === undefined
    ) {
      continue;
    }
    if (
      replicaMutation.atomicGroupId === undefined ||
      replicaMutation.atomicGroupSize === undefined
    ) {
      throw new Error("Replica data rejected: atomic group id and size must be provided together");
    }
    assertString("atomicGroupId", replicaMutation.atomicGroupId, MAX_OPERATION_ID_BYTES);
    assertRevision("atomicGroupSize", replicaMutation.atomicGroupSize);
    if (
      replicaMutation.atomicGroupSize <= 1 ||
      replicaMutation.atomicGroupSize > MAX_ATOMIC_GROUP_SIZE
    ) {
      throw new Error(
        `Replica capacity exceeded: atomic groups must contain 2 to ${MAX_ATOMIC_GROUP_SIZE} Folders`,
      );
    }
    if (
      replicaMutation.entity.kind !== "folder" ||
      replicaMutation.entity.value === null ||
      replicaMutation.entity.value.deletedAt !== null
    ) {
      throw new Error("Replica data rejected: atomic groups contain only live Folder upserts");
    }
    const group = groups.get(replicaMutation.atomicGroupId);
    if (group && group.size !== replicaMutation.atomicGroupSize) {
      throw new Error("Replica data rejected: atomic group size is inconsistent");
    }
    groups.set(replicaMutation.atomicGroupId, {
      size: replicaMutation.atomicGroupSize,
      count: (group?.count ?? 0) + 1,
    });
  }
  for (const group of groups.values()) {
    if (group.count !== group.size) {
      throw new Error("Replica data rejected: atomic group is incomplete");
    }
  }
}

/**
 * A stale Saved Post can add durable capture detail, but cannot overwrite note,
 * tags, or conflicting details observed by another installation.
 */
function mergeRicherSavedPost(
  current: SavedPostValue,
  incoming: SavedPostValue,
): SavedPostValue | null {
  if (current.statusId !== incoming.statusId) return null;
  if (
    current.note !== incoming.note ||
    current.tags.length !== incoming.tags.length ||
    current.tags.some((tag, index) => tag !== incoming.tags[index])
  ) {
    return null;
  }
  if (current.permalink && incoming.permalink && current.permalink !== incoming.permalink)
    return null;
  if (current.text && incoming.text && current.text !== incoming.text) return null;
  if (current.postedAt && incoming.postedAt && current.postedAt !== incoming.postedAt) return null;
  if (
    current.author &&
    incoming.author &&
    (current.author.screenName !== incoming.author.screenName ||
      (current.author.userId &&
        incoming.author.userId &&
        current.author.userId !== incoming.author.userId))
  ) {
    return null;
  }

  const media = [...current.media];
  for (const item of incoming.media) {
    if (!media.some((known) => known.kind === item.kind && known.url === item.url))
      media.push(item);
  }
  if (media.length > MAX_MEDIA) return null;

  const author = current.author ?? incoming.author;
  const text = current.text ?? incoming.text;
  const postedAt = current.postedAt ?? incoming.postedAt;
  const authorUserId = current.author?.userId ?? incoming.author?.userId;
  return {
    statusId: current.statusId,
    permalink: current.permalink ?? incoming.permalink,
    ...(author
      ? {
          author: {
            screenName: author.screenName,
            ...(authorUserId !== undefined ? { userId: authorUserId } : {}),
          },
        }
      : {}),
    ...(text !== undefined ? { text } : {}),
    media,
    ...(postedAt !== undefined ? { postedAt } : {}),
    capturedAt: Math.min(current.capturedAt, incoming.capturedAt),
    note: current.note,
    tags: current.tags,
  };
}

export const push = convexMutation({
  args: {
    deviceKey: v.string(),
    mutations: v.array(replicaMutationValidator),
  },
  returns: v.object({ results: v.array(replicaResultValidator) }),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    assertBatch(args.mutations);

    const known = await Promise.all(
      args.mutations.map(async (replicaMutation) => {
        const [receipt, entity] = await Promise.all([
          ctx.db
            .query("folderReplicaReceipts")
            .withIndex("by_operationId", (q) => q.eq("operationId", replicaMutation.operationId))
            .unique(),
          ctx.db
            .query("folderReplicaEntities")
            .withIndex("by_key", (q) => q.eq("key", replicaMutation.entity.key))
            .unique(),
        ]);
        return { receipt, entity };
      }),
    );
    const mutationByKey = new Map(
      args.mutations.map((replicaMutation) => [replicaMutation.entity.key, replicaMutation]),
    );
    const entityByKey = new Map<string, { key: string; entity: ReplicaEntity; revision: number }>();
    for (const { entity } of known) {
      if (entity) entityByKey.set(entity.key, entity);
    }
    const referencedKeys = new Set<string>();
    for (let index = 0; index < args.mutations.length; index += 1) {
      const replicaMutation = args.mutations[index];
      if (known[index]?.receipt || !replicaMutation || replicaMutation.entity.value === null)
        continue;
      if (replicaMutation.entity.kind === "folder-membership") {
        referencedKeys.add(key(["folder", replicaMutation.entity.folderId]));
        referencedKeys.add(key(["saved-post", replicaMutation.entity.statusId]));
      } else if (replicaMutation.entity.kind === "bookmark-evidence") {
        referencedKeys.add(key(["saved-post", replicaMutation.entity.statusId]));
      }
    }
    const referencedEntities = await Promise.all(
      [...referencedKeys]
        .filter((entityKey) => !entityByKey.has(entityKey))
        .map((entityKey) =>
          ctx.db
            .query("folderReplicaEntities")
            .withIndex("by_key", (q) => q.eq("key", entityKey))
            .unique(),
        ),
    );
    for (const entity of referencedEntities) {
      if (entity) entityByKey.set(entity.key, entity);
    }

    for (let index = 0; index < args.mutations.length; index += 1) {
      const replicaMutation = args.mutations[index];
      if (known[index]?.receipt || !replicaMutation || replicaMutation.entity.value === null)
        continue;
      const assertLiveReference = (entityKey: string, label: string): void => {
        const proposed = mutationByKey.get(entityKey);
        const existing = entityByKey.get(entityKey);
        if (
          (!proposed && (!existing || isTombstoned(existing.entity))) ||
          (proposed &&
            (isTombstoned(proposed.entity) ||
              (existing !== undefined && isTombstoned(existing.entity))))
        ) {
          throw new Error(
            `Replica data rejected: ${label} references a missing or tombstoned record`,
          );
        }
      };
      if (replicaMutation.entity.kind === "folder-membership") {
        assertLiveReference(
          key(["folder", replicaMutation.entity.folderId]),
          "folder-membership Folder",
        );
        assertLiveReference(
          key(["saved-post", replicaMutation.entity.statusId]),
          "folder-membership Saved Post",
        );
      } else if (replicaMutation.entity.kind === "bookmark-evidence") {
        assertLiveReference(
          key(["saved-post", replicaMutation.entity.statusId]),
          "bookmark-evidence Saved Post",
        );
      }
    }

    for (let index = 0; index < args.mutations.length; index += 1) {
      const replicaMutation = args.mutations[index];
      const prior = known[index];
      if (!replicaMutation || prior?.receipt || !prior?.entity) continue;
      if (replicaMutation.baseRevision > prior.entity.revision) {
        throw new Error("Replica data rejected: baseRevision is ahead of the entity revision");
      }
    }
    const atomicGroupSizes = new Map<string, number>();
    const atomicGroupReceiptCounts = new Map<string, number>();
    const atomicGroupConflicts = new Set<string>();
    for (let index = 0; index < args.mutations.length; index += 1) {
      const replicaMutation = args.mutations[index];
      const prior = known[index];
      if (!replicaMutation || !prior || replicaMutation.atomicGroupId === undefined) continue;
      const groupId = replicaMutation.atomicGroupId;
      const groupSize = replicaMutation.atomicGroupSize;
      if (groupSize === undefined)
        throw new Error("Replica data rejected: missing atomic group size");
      atomicGroupSizes.set(groupId, groupSize);
      if (prior.receipt) {
        atomicGroupReceiptCounts.set(groupId, (atomicGroupReceiptCounts.get(groupId) ?? 0) + 1);
        continue;
      }
      if (
        replicaMutation.baseRevision !== (prior.entity?.revision ?? 0) ||
        (prior.entity !== null && prior.entity !== undefined && isTombstoned(prior.entity.entity))
      ) {
        atomicGroupConflicts.add(groupId);
      }
    }
    for (const [groupId, groupSize] of atomicGroupSizes) {
      const receiptCount = atomicGroupReceiptCounts.get(groupId) ?? 0;
      if (receiptCount !== 0 && receiptCount !== groupSize) atomicGroupConflicts.add(groupId);
    }

    const cursor = await ctx.db
      .query("folderReplicaCursors")
      .withIndex("by_scope", (q) => q.eq("scope", "folder-replica"))
      .unique();
    let nextRevision = cursor?.revision ?? 0;
    const results: Array<{
      operationId: string;
      status: "accepted" | "conflict";
      revision: number;
    }> = [];

    for (let index = 0; index < args.mutations.length; index += 1) {
      const replicaMutation = args.mutations[index];
      const prior = known[index];
      if (!replicaMutation || !prior) {
        throw new Error("Replica data rejected: missing preflight state");
      }
      if (prior.receipt) {
        results.push({
          operationId: replicaMutation.operationId,
          status: prior.receipt.status,
          revision: prior.receipt.revision,
        });
        continue;
      }
      if (
        replicaMutation.atomicGroupId !== undefined &&
        atomicGroupConflicts.has(replicaMutation.atomicGroupId)
      ) {
        const revision = prior.entity?.revision ?? 0;
        await ctx.db.insert("folderReplicaReceipts", {
          operationId: replicaMutation.operationId,
          status: "conflict",
          revision,
          atomicGroupId: replicaMutation.atomicGroupId,
          atomicGroupSize: replicaMutation.atomicGroupSize,
        });
        results.push({
          operationId: replicaMutation.operationId,
          status: "conflict",
          revision,
        });
        continue;
      }

      const existing = prior.entity;
      let status: "accepted" | "conflict" = "accepted";
      let acceptedEntity = replicaMutation.entity;
      let revision = existing?.revision ?? 0;

      if (
        existing &&
        existing.entity.kind === "bookmark-evidence" &&
        replicaMutation.entity.kind === "bookmark-evidence" &&
        existing.entity.value !== null &&
        replicaMutation.entity.value !== null
      ) {
        if (replicaMutation.entity.value.observedAt <= existing.entity.value.observedAt) {
          acceptedEntity = existing.entity;
        }
      } else if (existing) {
        if (
          existing.entity.kind === "folder-membership" &&
          replicaMutation.entity.kind === "folder-membership" &&
          existing.entity.value !== null &&
          replicaMutation.entity.value !== null
        ) {
          acceptedEntity = existing.entity;
        } else if (replicaMutation.baseRevision === existing.revision) {
          if (isTombstoned(existing.entity) && replicaMutation.entity.value !== null) {
            status = "conflict";
          }
        } else if (existing.entity.value === null && replicaMutation.entity.value === null) {
          acceptedEntity = existing.entity;
        } else if (
          existing.entity.kind === "saved-post" &&
          replicaMutation.entity.kind === "saved-post" &&
          existing.entity.value !== null &&
          replicaMutation.entity.value !== null
        ) {
          const merged = mergeRicherSavedPost(existing.entity.value, replicaMutation.entity.value);
          if (merged === null) {
            status = "conflict";
          } else {
            acceptedEntity = { ...existing.entity, value: merged };
          }
        } else {
          status = "conflict";
        }
      } else if (replicaMutation.baseRevision !== 0) {
        throw new Error("Replica data rejected: baseRevision is ahead of the entity revision");
      }

      const entityChanged =
        !existing || JSON.stringify(existing.entity) !== JSON.stringify(acceptedEntity);
      if (status === "accepted" && (entityChanged || replicaMutation.atomicGroupId !== undefined)) {
        nextRevision += 1;
        revision = nextRevision;
        if (existing) {
          await ctx.db.patch(existing._id, {
            entity: acceptedEntity,
            revision,
          });
        } else {
          await ctx.db.insert("folderReplicaEntities", {
            key: acceptedEntity.key,
            entity: acceptedEntity,
            revision,
          });
        }
        await ctx.db.insert("folderReplicaChanges", {
          revision,
          operationId: replicaMutation.operationId,
          baseRevision: replicaMutation.baseRevision,
          ...(replicaMutation.atomicGroupId !== undefined
            ? {
                atomicGroupId: replicaMutation.atomicGroupId,
                atomicGroupSize: replicaMutation.atomicGroupSize,
              }
            : {}),
          entity: acceptedEntity,
        });
      } else if (status === "conflict") {
        revision = existing?.revision ?? 0;
      }

      await ctx.db.insert("folderReplicaReceipts", {
        operationId: replicaMutation.operationId,
        status,
        revision,
        ...(replicaMutation.atomicGroupId !== undefined
          ? {
              atomicGroupId: replicaMutation.atomicGroupId,
              atomicGroupSize: replicaMutation.atomicGroupSize,
            }
          : {}),
      });
      results.push({
        operationId: replicaMutation.operationId,
        status,
        revision,
      });
    }

    if (nextRevision !== (cursor?.revision ?? 0)) {
      if (cursor) await ctx.db.patch(cursor._id, { revision: nextRevision });
      else
        await ctx.db.insert("folderReplicaCursors", {
          scope: "folder-replica",
          revision: nextRevision,
        });
    }

    return { results };
  },
});

export const pull = query({
  args: {
    deviceKey: v.string(),
    cursor: v.number(),
    limit: v.number(),
  },
  returns: v.object({
    changes: v.array(replicaChangeValidator),
    cursor: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    assertDeviceKey(args.deviceKey);
    assertRevision("cursor", args.cursor);
    if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > MAX_REPLICA_PAGE_SIZE) {
      throw new Error(
        `Replica data rejected: limit must be between 1 and ${MAX_REPLICA_PAGE_SIZE}`,
      );
    }
    const current = await ctx.db
      .query("folderReplicaCursors")
      .withIndex("by_scope", (q) => q.eq("scope", "folder-replica"))
      .unique();
    if (args.cursor > (current?.revision ?? 0)) {
      throw new Error("Replica data rejected: cursor is ahead of the change stream");
    }

    const rows = await ctx.db
      .query("folderReplicaChanges")
      .withIndex("by_revision", (q) => q.gt("revision", args.cursor))
      .take(args.limit + 1);
    let page = rows.slice(0, args.limit);
    let done = rows.length <= args.limit;
    const boundaryGroupId = page.at(-1)?.atomicGroupId;
    if (boundaryGroupId !== undefined && rows[args.limit]?.atomicGroupId === boundaryGroupId) {
      const groupSize = page.at(-1)?.atomicGroupSize;
      if (
        groupSize === undefined ||
        !Number.isSafeInteger(groupSize) ||
        groupSize < 2 ||
        groupSize > MAX_ATOMIC_GROUP_SIZE
      ) {
        throw new Error("Replica change stream contains an invalid atomic group");
      }
      let delivered = 0;
      for (let index = page.length - 1; index >= 0; index -= 1) {
        if (page[index]?.atomicGroupId !== boundaryGroupId) break;
        delivered += 1;
      }
      const lookahead = rows[args.limit];
      if (!lookahead) throw new Error("Replica change stream atomic group is incomplete");
      if (lookahead.atomicGroupSize !== groupSize) {
        throw new Error("Replica change stream atomic group size is inconsistent");
      }
      page.push(lookahead);
      delivered += 1;
      if (delivered > groupSize) {
        throw new Error("Replica change stream atomic group exceeds its declared size");
      }
      while (delivered < groupSize) {
        const after = page.at(-1)?.revision ?? args.cursor;
        const next = await ctx.db
          .query("folderReplicaChanges")
          .withIndex("by_revision", (q) => q.gt("revision", after))
          .first();
        if (!next || next.atomicGroupId !== boundaryGroupId || next.atomicGroupSize !== groupSize) {
          throw new Error("Replica change stream atomic group is incomplete or noncontiguous");
        }
        page.push(next);
        delivered += 1;
      }
      done = (page.at(-1)?.revision ?? args.cursor) === (current?.revision ?? 0);
    }
    return {
      changes: page.map((row) => ({
        operationId: row.operationId,
        baseRevision: row.baseRevision,
        ...(row.atomicGroupId !== undefined
          ? {
              atomicGroupId: row.atomicGroupId,
              atomicGroupSize: row.atomicGroupSize,
            }
          : {}),
        entity: row.entity,
        revision: row.revision,
      })),
      cursor: page.at(-1)?.revision ?? args.cursor,
      done,
    };
  },
});
