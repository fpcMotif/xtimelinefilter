/**
 * The single centralized table of x.com DOM hooks (ADR-0004). When X redesigns,
 * this is the one file to fix. Ratings in docs/research/03-tweet-extraction.md.
 */
export const Selectors = {
  TWEET: 'article[data-testid="tweet"]',
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
 * Expando set on keyboard events that Lasso itself synthesizes (e.g. the
 * Escape that dismisses a stuck caret menu). The keyboard layer must ignore
 * these — otherwise driver-internal cleanup would exit select mode, clear the
 * selection, and swallow the event before X sees it.
 */
export const SYNTHETIC_EVENT_FLAG = "__lassoSyntheticEvent";

/** handle = [A-Za-z0-9_]{1,20}, status id = digits. Match against a pathname. */
export const PERMALINK_RE = /^\/([a-zA-Z\d_]{1,20})\/status\/(\d+)/;

/**
 * Hooks for the DOM-automation backend. The Lists-membership dialog internals are
 * the highest-churn, least-source-backed part (blueprint §8) — prefer role + text,
 * and VERIFY LIVE in DevTools before relying on them.
 */
export const DriverSelectors = {
  CARET: '[data-testid="caret"]',
  MENU: '[role="menu"]',
  MENUITEM: '[role="menuitem"]',
  DIALOG: '[role="dialog"]',
  CHECKBOX: '[role="checkbox"], input[type="checkbox"]',
  SAVE: '[data-testid="confirmationSheetConfirm"]',
  // The caret menu is portalled to body-level #layers, not inside the article.
  // data-testid="Dropdown" is GONE from current builds (verified live 2026-06-12);
  // [role="menu"] is the working anchor. DROPDOWN kept for older builds.
  DROPDOWN: '[data-testid="Dropdown"]',
  SHEET: '[data-testid="sheetDialog"]',
  BLOCK: '[data-testid="block"]',
  CONFIRM: '[data-testid="confirmationSheetConfirm"]',
} as const;

/**
 * Icon SVG path prefixes — the locale-proof way to find caret-menu rows (verified
 * live on x.com 2026-06; labels are localized so text matching is unreliable).
 */
export const MUTE_ICON_PATH_PREFIX = "M16 22h-2.35";
export const NOT_INTERESTED_ICON_PATH_PREFIX = "M12 13.6c1.64";

/** Localized-text fallbacks only (labels are translated, blueprint §8). */
export const ADD_TO_LISTS_TEXT = /add\s*\/\s*remove.*lists|add to list/i;
export const MUTE_TEXT = /^\s*(un)?mute/i;
export const NOT_INTERESTED_TEXT = /not interested|不感興趣|不感兴趣|興味がない/i;

/**
 * Not-interested follow-up panel: X swaps the tweet's article for a NEW article
 * WITHOUT data-testid="tweet" that holds plain buttons ordered [undo, show fewer
 * from user, irrelevant] (verified live 2026-06-12, zh-Hant UI:
 * 復原 / 減少顯示 @x 的貼文 / 這是不相關的貼文). Text first, position fallback.
 */
export const SHOW_FEWER_TEXT = /show fewer|see fewer|減少顯示|减少显示|表示を減らす/i;
export const POST_NOT_RELEVANT_TEXT =
  /(?:post|this).*(?:not relevant|irrelevant|isn['’]t relevant)|not relevant|irrelevant|不相關|不相关|関連性が(?:ありません|ない)/i;
export const UNDO_TEXT = /^\s*(undo|復原|复原|元に戻す)\s*$/i;
