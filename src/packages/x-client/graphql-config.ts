import type { GraphqlClientConfig } from "./types";

/**
 * Static FALLBACK seed of the internal GraphQL endpoints (ADR-0004). The runtime
 * resolver (graphql-ops.ts) may replace only compatible queryIds from X bundles.
 * This catalog keeps each ID, feature map, and field-toggle map atomic. A changed
 * metadata name set falls back here; it never mixes a new ID with guessed flags.
 * Do not bridge MAIN-world observations into this isolated-world client without
 * a reviewed threat model.
 *
 * ⚠️ IDs and metadata names were observed 2026-07-22. Bundles expose names,
 * not boolean values; these reviewed booleans remain the static fallback.
 * Compatible ID rotations are normally absorbed by the resolver.
 */
export const DEFAULT_GRAPHQL_CONFIG: GraphqlClientConfig = {
  baseUrl: "https://x.com/i/api/graphql",
  catalog: {
    ListAddMember: {
      queryId: "yhAkn9q5qaSCxPg_fpykDw",
      features: {
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: true,
        rweb_tipjar_consumption_enabled: false,
        verified_phone_label_enabled: false,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
      },
      // Reviewed X convention: both declared mutation toggles are sent as false.
      fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
    },
    ListRemoveMember: {
      queryId: "c2IzeyWiwaQBkFs2VV_vSA",
      features: {
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: true,
        rweb_tipjar_consumption_enabled: false,
        verified_phone_label_enabled: false,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
      },
      // Reviewed X convention: both declared mutation toggles are sent as false.
      fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
    },
    UserByScreenName: {
      queryId: "2qvSHpkWTMS9i0zJAwDNiA",
      features: {
        hidden_profile_subscriptions_enabled: true,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: true,
        rweb_tipjar_consumption_enabled: false,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: true,
        subscriptions_feature_can_gift_premium: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
      },
      fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
    },
  },
};
