import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Owners — the X account logged in at action time. "Account/Author" stays
  // reserved for the *member*; the operator is the Owner.
  accounts: defineTable({
    userId: v.string(), // X rest_id (twid), the identity
    screenName: v.string(),
    label: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Cross-account catalog of Lists.
  lists: defineTable({
    listId: v.string(),
    name: v.string(),
    ownerUserId: v.string(),
    isPrivate: v.optional(v.boolean()),
    memberCount: v.optional(v.number()),
    lastReconciledAt: v.optional(v.number()),
  })
    .index("by_listId", ["listId"])
    .index("by_owner", ["ownerUserId"]),

  // Membership snapshot — lazily-filled (List, screenName) presence map.
  members: defineTable({
    listId: v.string(),
    memberScreenName: v.string(),
    memberUserId: v.optional(v.string()),
    present: v.boolean(),
    source: v.union(v.literal("x-seed"), v.literal("extension")),
    addedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_list_member", ["listId", "memberScreenName"])
    .index("by_member", ["memberScreenName"]),

  // Audit log — append-only, one row per attempt, every outcome.
  events: defineTable({
    listId: v.string(),
    ownerUserId: v.string(),
    memberScreenName: v.string(),
    memberUserId: v.optional(v.string()),
    action: v.union(v.literal("add"), v.literal("remove")),
    outcome: v.string(),
    message: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_at", ["at"]),
});
