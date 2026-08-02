import { v } from "convex/values";

const mediaValidator = v.object({
  kind: v.union(v.literal("photo"), v.literal("video")),
  url: v.optional(v.string()),
});

const savedPostValueValidator = v.object({
  statusId: v.string(),
  permalink: v.union(v.string(), v.null()),
  author: v.optional(
    v.object({
      screenName: v.string(),
      userId: v.optional(v.string()),
    }),
  ),
  text: v.optional(v.string()),
  media: v.array(mediaValidator),
  postedAt: v.optional(v.string()),
  capturedAt: v.number(),
  note: v.string(),
  tags: v.array(v.string()),
});

export const replicaEntityValidator = v.union(
  v.object({
    kind: v.literal("folder"),
    key: v.string(),
    folderId: v.string(),
    value: v.union(
      v.object({
        folderId: v.string(),
        name: v.string(),
        sortIndex: v.number(),
        createdAt: v.number(),
        updatedAt: v.number(),
        deletedAt: v.union(v.number(), v.null()),
      }),
      v.null(),
    ),
  }),
  v.object({
    kind: v.literal("saved-post"),
    key: v.string(),
    statusId: v.string(),
    value: v.union(savedPostValueValidator, v.null()),
  }),
  v.object({
    kind: v.literal("folder-membership"),
    key: v.string(),
    folderId: v.string(),
    statusId: v.string(),
    value: v.union(
      v.object({
        folderId: v.string(),
        statusId: v.string(),
        addedAt: v.number(),
      }),
      v.null(),
    ),
  }),
  v.object({
    kind: v.literal("bookmark-evidence"),
    key: v.string(),
    statusId: v.string(),
    xAccountId: v.string(),
    value: v.union(
      v.object({
        statusId: v.string(),
        xAccountId: v.string(),
        outcome: v.union(v.literal("confirmed"), v.literal("failed"), v.literal("skipped")),
        observedAt: v.number(),
      }),
      v.null(),
    ),
  }),
);

export const replicaMutationValidator = v.object({
  operationId: v.string(),
  baseRevision: v.number(),
  atomicGroupId: v.optional(v.string()),
  atomicGroupSize: v.optional(v.number()),
  entity: replicaEntityValidator,
});

export const replicaChangeValidator = v.object({
  operationId: v.string(),
  baseRevision: v.number(),
  entity: replicaEntityValidator,
  atomicGroupId: v.optional(v.string()),
  atomicGroupSize: v.optional(v.number()),
  revision: v.number(),
});
