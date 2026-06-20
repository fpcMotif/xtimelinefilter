import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType } from "convex/server";

// convex/_generated lives outside src/ (own tsconfig); the api refs stay opaque
// to ConvexMembershipStore, so this glue file is the only src/ → convex/ import.
import { api } from "../../../convex/_generated/api";
import { type CatalogGroup, type ConvexCalls, ConvexMembershipStore } from "./convex";
import type { MembershipStore } from "./types";
import type { MembershipHit } from "./types";

/**
 * Compile-time bridge restoring the generated-type boundary the seam's result
 * casts (convex.ts) would otherwise erase: if a membership query's backend
 * validator drifts from the shape the store casts to, the matching assertion
 * stops resolving to `true` and the build fails — so convex/ stays the single
 * source of truth for these wire types (ADR-0009), with zero runtime cost.
 */
type Assignable<A, B> = A extends B ? true : false;
const ASSERT_LISTS_CONTAINING: Assignable<
  FunctionReturnType<typeof api.membership.listsContaining>,
  MembershipHit[]
> = true;
const ASSERT_CATALOG: Assignable<
  FunctionReturnType<typeof api.membership.catalog>,
  CatalogGroup[]
> = true;
void ASSERT_LISTS_CONTAINING;
void ASSERT_CATALOG;

/**
 * Builds the real Mirror over a Convex HTTP client. HTTP (not the reactive
 * WebSocket) is deliberate for the record/reconcile path: no persistent
 * connection to be killed with an MV3 service worker, and a plain cross-origin
 * POST that `host_permissions` + Convex's CORS allow. The picker's live "already
 * in" subscription layers a reactive client on top separately (goal 7).
 */
export function buildConvexMembershipStore(cfg: {
  url: string;
  deviceKey: string;
}): MembershipStore {
  const http = new ConvexHttpClient(cfg.url);
  const calls: ConvexCalls = {
    mutation: (ref, args) => http.mutation(ref as FunctionReference<"mutation">, args),
    query: (ref, args) => http.query(ref as FunctionReference<"query">, args),
  };
  return new ConvexMembershipStore(calls, api.membership, cfg.deviceKey);
}
