import type { GraphqlConfig } from "./types";

/**
 * Static snapshot of the internal GraphQL endpoints (ADR-0004). queryIds + the
 * features object may rotate, so GraphQL is explicit opt-in. A 404 fails as a
 * typed, visible error; update this file after a live, deliberate verification.
 * Do not bridge MAIN-world observations into this isolated-world client without
 * a reviewed threat model.
 *
 * ⚠️ These query ids are point-in-time and MUST be verified live before relying
 * on the GraphQL backend. REST is the current default, but uses undocumented web
 * v1.1 endpoints; it needs none of this query-id configuration.
 */
export const DEFAULT_GRAPHQL_CONFIG: GraphqlConfig = {
  baseUrl: "https://x.com/i/api/graphql",
  ops: {
    ListAddMember: "P4_AWHREi9pjC9G4_C5OFw",
    ListRemoveMember: "cYUas2BWBcZHvksAtTMOlw",
    UserByScreenName: "sLVLhk0bGj3MVFEKTdax1w",
  },
  features: {
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
  },
};
