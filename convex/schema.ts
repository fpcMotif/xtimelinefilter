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
    /** Accepted complete-catalog generation. Missing legacy value means 0. */
    catalogGeneration: v.optional(v.number()),
    /** Fetch-start time of the newest accepted complete catalog. */
    catalogObservedAt: v.optional(v.number()),
    /** Newest direct action proving that some List still exists. */
    catalogFactObservedAt: v.optional(v.number()),
    /** Newest observation allowed to update this Owner's display profile. */
    profileObservedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  // Cross-account catalog of Lists.
  lists: defineTable({
    listId: v.string(),
    name: v.string(),
    ownerUserId: v.string(),
    isPrivate: v.optional(v.boolean()),
    memberCount: v.optional(v.number()),
    lastReconciledAt: v.optional(v.number()),
    /** Owner generation in which this List was last proven current. */
    catalogGeneration: v.optional(v.number()),
  })
    .index("by_listId", ["listId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_owner_generation", ["ownerUserId", "catalogGeneration"]),

  // Membership snapshot. Handle-keyed legacy rows remain valid during migration
  // but are unread: all new reads use memberIdentity.
  members: defineTable({
    listId: v.string(),
    memberScreenName: v.string(),
    memberUserId: v.optional(v.string()),
    memberIdentity: v.optional(v.string()),
    present: v.boolean(),
    source: v.union(v.literal("x-seed"), v.literal("extension")),
    /** Source observation time. Missing legacy value means 0. */
    observedAt: v.optional(v.number()),
    addedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_list_member", ["listId", "memberScreenName"])
    .index("by_member", ["memberScreenName"])
    .index("by_list_member_identity", ["listId", "memberIdentity"])
    .index("by_member_identity", ["memberIdentity"]),

  // Audit log — append-only, one row per attempt, every outcome.
  events: defineTable({
    listId: v.string(),
    ownerUserId: v.string(),
    memberScreenName: v.string(),
    memberUserId: v.optional(v.string()),
    memberIdentity: v.optional(v.string()),
    action: v.union(v.literal("add"), v.literal("remove")),
    outcome: v.string(),
    /** Mutation receipt strength. Missing values are legacy audit-only events. */
    evidence: v.optional(v.union(v.literal("server-response"), v.literal("ui-state"))),
    message: v.optional(v.string()),
    /** Source observation time; `at` remains Mirror receipt time. */
    observedAt: v.optional(v.number()),
    at: v.number(),
  })
    .index("by_list", ["listId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_at", ["at"]),
});
