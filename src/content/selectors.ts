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
 * Hooks the durable capture (`tweet-read`'s `capture()`) needs on top of the
 * tables above: the URL reference inside an already-matched media node, the
 * post's own timestamp, and the follow button. The media KIND still comes from
 * FacetSelectors.PHOTO / FacetSelectors.VIDEO — these locate a URL, they never
 * classify one.
 *
 * AMBER — every entry here is an ASSUMPTION until confirmed on live x.com
 * (verify-capture-dom.md).
 */
export const CaptureSelectors = {
  MEDIA_IMG: "img[src]",
  VIDEO_POSTER: "video[poster]",
  TIMESTAMP: "time",
  FOLLOW_BUTTON: "[data-testid$='-follow'], [data-testid$='-unfollow']",
} as const;

/**
 * The follow button's testid is `<rest_id>-follow` / `<rest_id>-unfollow` — the
 * one place a tweet article exposes the numeric user id, and only when X renders
 * that button. Requiring an all-digit prefix keeps non-id testids out. Research
 * 03 §4 is otherwise right that `rest_id` is NOT a DOM attribute; the avatar CDN
 * path is NOT a source (its first segment is the image's id, not the user's).
 */
export const FOLLOW_BUTTON_USER_ID_RE = /^(\d+)-(?:un)?follow$/;

/** Hosts whose `/status/` paths are X's own. A relative href resolves here. */
export const X_PERMALINK_HOST_RE = /(?:^|\.)(?:x\.com|twitter\.com)$/i;

/**
 * Expando set on keyboard events that Lasso itself synthesizes (e.g. the
 * Escape that dismisses a stuck caret menu). The keyboard layer must ignore
 * these — otherwise driver-internal cleanup would exit select mode, clear the
 * selection, and swallow the event before X sees it.
 */
export const SYNTHETIC_EVENT_FLAG = "__lassoSyntheticEvent";

/** handle = [A-Za-z0-9_]{1,20}, status id = digits. Match against a pathname. */
export const PERMALINK_RE = /^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)/;
