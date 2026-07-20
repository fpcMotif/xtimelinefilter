import type { GraphqlConfig } from "./types";

/**
 * Static FALLBACK seed of the internal GraphQL endpoints (ADR-0004). The runtime
 * resolver (graphql-ops.ts) scrapes fresh queryIds from X's own bundles and only
 * lands here when scraping fails — so these are the last line, not the contract.
 * queryIds + the features object rotate with X deploys, so GraphQL is explicit
 * opt-in. A 404 after one resolver refresh fails as a typed, visible error.
 * Do not bridge MAIN-world observations into this isolated-world client without
 * a reviewed threat model.
 *
 * ⚠️ Live-verified 2026-07-19 against X's production build (ListAddMember /
 * ListRemoveMember from bundle.LoggedInMain.db1efb1a.js, UserByScreenName from
 * main.046fa29a.js — both located via the inline webpack chunk map in the x.com
 * HTML, the same path the runtime resolver takes).
 */
export const DEFAULT_GRAPHQL_CONFIG: GraphqlConfig = {
  baseUrl: "https://x.com/i/api/graphql",
  ops: {
    ListAddMember: "yhAkn9q5qaSCxPg_fpykDw",
    ListRemoveMember: "c2IzeyWiwaQBkFs2VV_vSA",
    UserByScreenName: "2qvSHpkWTMS9i0zJAwDNiA",
  },
  features: {
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
  },
};
