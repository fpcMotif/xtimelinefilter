import { PERMALINK_RE } from "@/content/selectors";

/**
 * The shared status-anchor / permalink parsing core for the tweet-read module —
 * the one place author() (it needs {screenName, tweetId}) and identity() (it needs
 * a recycle-safe per-cell key) both reach the /status/ permalink. Private to
 * tweet-read; never re-exported from index.ts.
 */

/** URL-safe pathname of an anchor's href (robust against happy-dom base-URL quirks). */
export function pathnameOf(a: Element): string {
  try {
    return new URL(a.getAttribute("href") ?? "", "https://x.com").pathname;
  } catch {
    return "";
  }
}

/** Strict permalink parse — /<screenName>/status/<id>. Used by author(). */
export function parsePermalink(a: Element): { screenName: string; tweetId: string } | null {
  const m = pathnameOf(a).match(PERMALINK_RE);
  return m ? { screenName: m[1] as string, tweetId: m[2] as string } : null;
}

/** Loose status id from the first /status/ anchor (digits only). Used by identity(). */
export function statusId(article: Element): string | null {
  const href = article.querySelector('a[href*="/status/"]')?.getAttribute("href") ?? "";
  const m = /\/status\/(\d+)/.exec(href);
  return m ? (m[1] as string) : null;
}
