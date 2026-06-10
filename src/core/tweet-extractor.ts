import { AVATAR_CONTAINER_PREFIX, PERMALINK_RE, Selectors } from "@/content/selectors";
import type { TweetAuthor } from "@/core/selection-store";

export type TweetType = "tweet" | "retweet" | "promoted";

/**
 * Pure, ISOLATED-world-safe extraction of the author from a tweet article.
 * Leaves userId undefined (rest_id is not in the DOM — resolved later via
 * UserByScreenName). See docs/research/03-tweet-extraction.md.
 */
export function extractAuthor(article: Element): TweetAuthor | null {
  if (!isTweet(article)) return null;
  if (getTweetType(article) === "promoted") return null; // skip ads

  const nameBlock = article.querySelector(Selectors.USER_NAME);
  const authorLink =
    nameBlock?.querySelector('a[href*="/status/"]') ??
    article.querySelector("time")?.closest('a[href*="/status/"]') ??
    null;
  const pl = authorLink ? parsePermalink(authorLink) : null;

  const screenName = pl?.screenName ?? handleFromAvatar(article);
  if (!screenName) return null;

  return {
    screenName,
    tweetId: pl?.tweetId,
    displayName: readDisplayName(article, screenName),
    avatarUrl: readAvatar(article),
    userId: undefined,
  };
}

export function getTweetType(article: Element): TweetType {
  if (article.closest(Selectors.PROMOTED_ANCESTOR)) return "promoted";
  const social = article.querySelector(Selectors.SOCIAL_CONTEXT);
  if (social && /promoted/i.test(social.textContent ?? "")) return "promoted";
  if (social) return "retweet";
  return "tweet";
}

function isTweet(el: Element | null): el is Element {
  return !!el && el.getAttribute?.("data-testid") === "tweet";
}

function parsePermalink(a: Element): { screenName: string; tweetId: string } | null {
  const m = pathnameOf(a).match(PERMALINK_RE);
  return m ? { screenName: m[1] as string, tweetId: m[2] as string } : null;
}

/** Robust against happy-dom base-URL quirks: resolve hrefs against a fixed base. */
function pathnameOf(a: Element): string {
  try {
    return new URL(a.getAttribute("href") ?? "", "https://x.com").pathname;
  } catch {
    return "";
  }
}

function handleFromAvatar(article: Element): string | null {
  const tid = article.querySelector(Selectors.AVATAR_CONTAINER)?.getAttribute("data-testid");
  return tid?.startsWith(AVATAR_CONTAINER_PREFIX)
    ? tid.slice(AVATAR_CONTAINER_PREFIX.length)
    : null;
}

function readDisplayName(article: Element, screenName: string): string | undefined {
  const block = article.querySelector(Selectors.USER_NAME);
  if (!block) return undefined;
  const nameLink = [...block.querySelectorAll("a")].find((a) => pathnameOf(a) === `/${screenName}`);
  const raw = readText(nameLink ?? block)
    .replace(/\s+/g, " ")
    .trim();
  return raw || undefined;
}

function readAvatar(article: Element): string | undefined {
  const img = article.querySelector<HTMLImageElement>(Selectors.AVATAR_IMG);
  return img?.getAttribute("src") ?? undefined;
}

/** Reads visible text, expanding emoji <img alt> and ignoring badge <svg> text. */
function readText(node: Node): string {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.nodeValue ?? "";
    else if (n.nodeName === "IMG") out += (n as HTMLImageElement).alt ?? "";
    else if (n.nodeType === 1) out += readText(n);
  });
  return out;
}
