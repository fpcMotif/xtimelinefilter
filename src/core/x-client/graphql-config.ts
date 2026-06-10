import type { GraphqlConfig } from "./types";

/**
 * Seed snapshot of the internal GraphQL endpoints (ADR-0004). queryIds + the
 * features object ROTATE every ~2–4 weeks (blueprint §8), so this is only a
 * starting point — the GraphQL backend is opt-in and the runtime sniffer
 * (sniffGraphqlConfig) refreshes these from the app's own traffic. Treat 404 /
 * "features cannot be null" as a signal to re-discover.
 *
 * ⚠️ These query ids are point-in-time and MUST be verified live before relying
 * on the GraphQL backend; the DOM backend is the default precisely because it
 * needs none of this.
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
