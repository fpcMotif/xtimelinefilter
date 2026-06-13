import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

// convex/_generated lives outside src/ (own tsconfig); the api refs stay opaque
// to ConvexMembershipStore, so this glue file is the only src/ → convex/ import.
import { api } from "../../../convex/_generated/api";

import { type ConvexCalls, ConvexMembershipStore } from "./convex";
import type { MembershipStore } from "./types";

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
