/**
 * The single centralized table of x.com DOM hooks (ADR-0004). When X redesigns,
 * this is the one file to fix. Ratings in docs/research/03-tweet-extraction.md.
 */
export const Selectors = {
  TWEET: 'article[data-testid="tweet"]',
  TWEET_CARET: '[data-testid="caret"]',
  CELL: 'div[data-testid="cellInnerDiv"]',
  PRIMARY_COLUMN: 'div[data-testid="primaryColumn"]',
  USER_NAME: '[data-testid="User-Name"]',
  STATUS_LINK_IN_NAME: '[data-testid="User-Name"] a[href*="/status/"]',
  AVATAR_CONTAINER: '[data-testid^="UserAvatar-Container-"]',
  AVATAR_IMG: '[data-testid^="UserAvatar-Container-"] img[src]',
  SOCIAL_CONTEXT: '[data-testid="socialContext"]',
  PROMOTED_ANCESTOR: '[data-testid="placementTracking"]',
  TWEET_TEXT: '[data-testid="tweetText"]',
  // Logged-in Owner's handle: href is `/<screenName>` (verified live 2026-06-13).
  CURRENT_USER_PROFILE_LINK: 'a[data-testid="AppTabBar_Profile_Link"]',
} as const;

export const AVATAR_CONTAINER_PREFIX = "UserAvatar-Container-";

/**
 * Hooks for the Filter capability's Facet extraction (tweet-read/facets.ts). The one
 * place to fix on an X redesign (ADR-0004). Reuse Selectors.TWEET_TEXT (the lang
 * attribute lives there), Selectors.SOCIAL_CONTEXT (repost) and Selectors.CELL.
 *
 * AMBER — every entry here is an ASSUMPTION until confirmed on live x.com
 * (verify-filter-dom.md, MISSION.md). QUOTE especially: a quoted post nests a
 * second tweet article, but the exact hook must be verified live.
 */
export const FacetSelectors = {
  PHOTO: '[data-testid="tweetPhoto"]',
  VIDEO: '[data-testid="videoPlayer"], [data-testid="videoComponent"]',
  CARD: '[data-testid="card.wrapper"]',
  QUOTE: '[data-testid="tweet"] [data-testid="tweet"]', // AMBER — verify live
  OUTBOUND_LINK: 'a[href^="http"]',
  // Owner "liked" state: the action-bar like button's testid FLIPS to `unlike`
  // once liked. Present ⇒ already liked. Read host-scoped (facets.ts) so a quoted
  // post's bar can't leak. VERIFIED live 2026-06-27 (Home un-liked → 0/11, the
  // Bookmarks page → 11/11; aria "已喜歡"). NB: this build renders NO bookmark
  // button inline, so there is no "bookmarked" hook — see verify-filter-dom.md.
  LIKED: '[data-testid="unlike"]',
} as const;

/**
 * Expando set on keyboard events that Lasso itself synthesizes (e.g. the
 * Escape that dismisses a stuck caret menu). The keyboard layer must ignore
 * these — otherwise driver-internal cleanup would exit select mode, clear the
 * selection, and swallow the event before X sees it.
 */
export const SYNTHETIC_EVENT_FLAG = "__lassoSyntheticEvent";

/** handle = [A-Za-z0-9_]{1,20}, status id = digits. Match against a pathname. */
export const PERMALINK_RE = /^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)/;
