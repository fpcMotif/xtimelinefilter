/**
 * Canonical user-facing strings (product story "Canonical strings — implement
 * verbatim"). Every surface counts PEOPLE, not posts; confirmations are past
 * tense; failure copy is literal. Copy lives here so no component invents its
 * own wording and the strings test pins each one.
 */

/** Tabular-friendly count: 1204 → "1,204". */
export const formatCount = (n: number): string => n.toLocaleString("en-US");

// 1 — picker header
export function pickerHeader(authors: ReadonlyArray<{ screenName: string }>): string {
  const first = authors[0];
  if (authors.length === 1 && first) return `Add @${first.screenName} to a List`;
  return `Add ${formatCount(authors.length)} people to a List`;
}

// 2 — input placeholder
export const SEARCH_PLACEHOLDER = "Search Lists";

// 3 — success toast + actions
export const addedLine = (added: number, listName: string): string =>
  `Added ${formatCount(added)} to ${listName}`;
export const VIEW_LIST = "View List";
export const UNDO = "Undo";

// 4 — idempotent line 2
export const alreadyInLine = (n: number): string =>
  n === 1 ? "1 was already in the List" : `${formatCount(n)} were already in the List`;

// 5 — protected author
export const protectedLine = (screenName: string): string =>
  `@${screenName} is protected and can't be added`;

// 6 — rate limit
export const RATE_LIMIT_TITLE = "X rate limit reached";
export const rateLimitLine = (added: number, remaining: number, minutes: number | null): string =>
  `Added ${formatCount(added)} · ${formatCount(remaining)} still selected — try again in ${
    minutes === null ? "a few minutes" : `${minutes} min`
  }`;

// 7 — picker error
export const PICKER_ERROR_TITLE = "Couldn't load your Lists";
export const PICKER_ERROR_LOGGED_OUT = "You may be logged out of X";
export const PICKER_ERROR_RATE_LIMITED = "X rate limited Lasso — try again in a few minutes";
export const PICKER_ERROR_UNKNOWN = "X didn't respond — try again";
export const RETRY = "Retry";

// 8 — true empty
export const EMPTY_TITLE = "You don't have any Lists yet";
export const EMPTY_BODY = "Lists let you group people on X";
export const EMPTY_CTA = "Create a List on X";
export const CREATE_LIST_URL = "https://x.com/i/lists/create";

// 9 — no match
export const noMatchLine = (query: string): string => `No Lists match "${query}"`;
export const CLEAR_SEARCH = "Clear search";
export const createOnX = (query: string): string => `Create "${query}" on X`;

// 10 — no-target nudge
export const NO_TARGET_NUDGE = "Hover a post first — or press j to focus one";

// 11 — mute
export const mutedLine = (screenName: string): string => `Muted @${screenName}`;
export const muteFailedLine = (screenName: string): string => `Couldn't mute @${screenName}`;

// 12 — select-mode bar
export const SELECT_MODE_BAR = "Select mode · click posts or press x · s when done";

// 13 — post-assign tip
export const POST_ASSIGN_TIP = "Tip: Alt+L on a hovered post does this without the mouse";

// 14 — select-mode nudge
export const SELECT_MODE_NUDGE = "Tip: press s to select by clicking posts";

// 15 — trust line
export const TRUST_LINE = "Lasso runs entirely in your browser. Nothing leaves x.com.";

// 16 — wake toast
export const WAKE_TOAST = "Lasso is awake on this tab";

// 17 — progress
export const progressLine = (current: number, total: number, listName: string): string =>
  `Adding ${formatCount(current)} of ${formatCount(total)} to ${listName}…`;
export const STOP = "Stop";
export const afterStopLine = (added: number, remaining: number): string =>
  `${formatCount(added)} added · ${formatCount(remaining)} still selected`;

// 18 — unit tooltip
export const UNIT_TOOLTIP = "Lasso adds people to Lists, not posts.";

// 19 — selector health
export const SELECTOR_HEALTH =
  "Lasso can't read the timeline — X may have changed. Check for an update.";

// 20 — shortcuts footer
export const SHORTCUTS_FOOTER =
  "j and k move between posts — those are X's own shortcuts. Lasso never overrides them.";

// ——— Derived / surrounding copy (story beats 3–9) ———

export const peopleSelected = (n: number): string =>
  n === 1 ? "1 person selected" : `${formatCount(n)} people selected`;

export const memberCountLabel = (n: number): string =>
  n === 1 ? "1 member" : `${formatCount(n)} members`;

export const addedPartialLine = (added: number, listName: string, failed: number): string =>
  `${addedLine(added, listName)} · ${formatCount(failed)} failed`;

export const NOTHING_ADDED = "Nothing was added";

export const HIDDEN_LINE = "Hidden — not interested";
export const hideFailedLine = "Couldn't hide that post";

export const removedLine = (n: number, listName: string): string =>
  `Removed ${formatCount(n)} from ${listName}`;
export const unmutedLine = (screenName: string): string => `Unmuted @${screenName}`;
export const blockedLine = (screenName: string): string => `Blocked @${screenName}`;
export const blockFailedLine = (screenName: string): string => `Couldn't block @${screenName}`;

export const pickerFooterLegend = (selected: number): string =>
  `↑↓ Navigate · Enter Add · Esc Dismiss · ${formatCount(selected)} selected`;

export const WELCOME_TITLE = "Lasso is ready";
export const WELCOME_ROWS: readonly string[] = [
  "Hover any post and press Alt+L to file its author into a List",
  "Press s to select many people, then add them all at once",
  "Press ? anytime to see every shortcut",
];
export const WELCOME_CTA = "Try select mode";
export const WELCOME_SKIP = "Skip";

export const FIRST_HOVER_TIP = "Select — then add everyone to a List at once.";

export const SHORTCUTS_TITLE = "Keyboard shortcuts";

// Settings / popup copy (story beat 9)
export const PRIVACY_LINE =
  "Lasso has no servers. Your X session, your Lists, and your usage stats never leave this browser.";
export const POPUP_ACTIVE = "Active on x.com";
export const POPUP_ASLEEP = "Asleep — click to wake";

/** Whole minutes until an x-rate-limit-reset epoch (seconds); floors at 1. */
export function minutesUntil(resetEpochSeconds: number, nowMs: number): number {
  return Math.max(1, Math.ceil((resetEpochSeconds * 1000 - nowMs) / 60_000));
}
