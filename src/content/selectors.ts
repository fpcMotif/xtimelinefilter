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
} as const;

export const AVATAR_CONTAINER_PREFIX = "UserAvatar-Container-";

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
  DROPDOWN: '[data-testid="Dropdown"]',
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
export const NOT_INTERESTED_TEXT = /not interested/i;

/**
 * Not-interested follow-up panel (replaces the article inside the cell): plain
 * buttons with no testids or icons, ordered [undo, show fewer from user,
 * irrelevant] (verified live 2026-06, zh-Hant UI). Text first, position fallback.
 */
export const SHOW_FEWER_TEXT = /show fewer|see fewer|減少顯示|减少显示/i;
export const UNDO_TEXT = /^\s*(undo|復原|复原)\s*$/i;
