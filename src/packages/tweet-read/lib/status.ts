import { PERMALINK_RE, X_PERMALINK_HOST_RE } from "@/content/selectors";

/**
 * The shared status-anchor / permalink parsing core for the tweet-read module —
 * the one place author() (it needs {screenName, tweetId}), identity() (it needs a
 * recycle-safe per-cell key) and capture() (it needs a permalink it can write
 * down) all reach the /status/ permalink. Private to tweet-read; never
 * re-exported from index.ts.
 *
 * The three reads want different strictness, which is the point of keeping them
 * side by side: statusId() is deliberately loose, parsePermalink() is anchored,
 * and parseHostedPermalink() also checks the origin.
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

/**
 * Anchored permalink parse that also checks the ORIGIN. Used by capture(), which
 * must not accept somebody else's link: normalizing an href to a pathname throws
 * the host away, so `/handle/status/123` on a foreign host would otherwise read
 * as one of X's own.
 */
export function parseHostedPermalink(a: Element): { screenName: string; tweetId: string } | null {
  try {
    const url = new URL(a.getAttribute("href") ?? "", "https://x.com");
    if (!X_PERMALINK_HOST_RE.test(url.hostname)) return null;
    const m = url.pathname.match(PERMALINK_RE);
    return m ? { screenName: m[1] as string, tweetId: m[2] as string } : null;
  } catch {
    return null;
  }
}

/** Loose status id from the first /status/ anchor (digits only). Used by identity(). */
export function statusId(article: Element): string | null {
  const href = article.querySelector('a[href*="/status/"]')?.getAttribute("href") ?? "";
  const m = /\/status\/(\d+)/.exec(href);
  return m ? (m[1] as string) : null;
}
