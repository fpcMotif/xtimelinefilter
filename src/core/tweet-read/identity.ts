import { Selectors } from "@/content/selectors";

import { statusId } from "./status";

/** Trimmed visible tweet text, or null when the post has no tweetText node. */
function tweetText(article: Element): string | null {
  const el = article.querySelector(Selectors.TWEET_TEXT);
  if (!el) return null;
  /* v8 ignore next -- an Element's textContent is never null at runtime; ?? "" is a type-required guard */
  return el.textContent?.trim() ?? "";
}

/**
 * Stable per-tweet identity for the Filter's recycle-safe "show" override: the
 * status id from the permalink, falling back to the visible text for posts whose
 * permalink hasn't resolved. Empty string when neither is available (still stable
 * for one node).
 */
export function identity(article: Element): string {
  return statusId(article) ?? tweetText(article) ?? "";
}
