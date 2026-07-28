import {
  CaptureSelectors,
  FacetSelectors,
  FOLLOW_BUTTON_USER_ID_RE,
  Selectors,
} from "@/content/selectors";

import { handleFromAvatarContainer, hostOwn, isHostOwn, readCollapsedText } from "./dom";
import { safe } from "./guard";
import { parseHostedPermalink } from "./status";

type MediaKind = "photo" | "video";

/**
 * The durable capture: what this post IS and what it SAID, in a form safe to
 * write down and come back to weeks later. Distinct from identity(), which is
 * the scanner's recycle-safe per-cell key and is deliberately loose.
 *
 * Keyed by status id and nothing else — no signed-in account, no Owner, no
 * session. The same article captures identically whichever X account the page
 * is signed in as.
 *
 * Only `statusId` is load-bearing: null means this post cannot be saved, and the
 * caller must say so rather than invent an id. Everything else is best-effort,
 * host-scoped the same way, and guarded — a malformed article degrades to a
 * partial capture and the read never throws.
 */
export type TweetCapture = {
  /** null ⇒ this post cannot be saved. */
  statusId: string | null;
  /** null iff statusId is null; composed, never copied raw. */
  permalink: string | null;
  /**
   * Denormalized DISPLAY data, never identity — deliberately NOT `TweetAuthor`,
   * which carries the extra fields List assignment needs.
   */
  author?: { screenName: string; userId?: string };
  text?: string;
  media: { kind: MediaKind; url?: string }[];
  postedAt?: string;
};

/** Both media kinds in one document-ordered sweep; kind comes from the hooks. */
const MEDIA = `${FacetSelectors.PHOTO}, ${FacetSelectors.VIDEO}`;

/**
 * This article's OWN permalink: the User-Name block's first, the timestamp's
 * second. A quoted post is itself a tweet article, so document order must not be
 * allowed to decide — every candidate must be host-scoped AND parse.
 */
function readPermalink(article: Element) {
  const timestampLinks = [...article.querySelectorAll(CaptureSelectors.TIMESTAMP)]
    .map((t) => t.closest("a"))
    .filter((a): a is HTMLAnchorElement => !!a);
  for (const a of [...article.querySelectorAll(Selectors.STATUS_LINK_IN_NAME), ...timestampLinks]) {
    if (!isHostOwn(a, article)) continue;
    const pl = parseHostedPermalink(a);
    if (pl) return pl;
  }
  return null;
}

function readAuthor(article: Element, screenName: string | undefined): TweetCapture["author"] {
  const name =
    screenName ?? handleFromAvatarContainer(hostOwn(article, Selectors.AVATAR_CONTAINER));
  if (!name) return undefined;
  const userId = readUserId(article);
  return { screenName: name, ...(userId ? { userId } : {}) };
}

/** X exposes the numeric id only when it renders a follow button for the author. */
function readUserId(article: Element): string | undefined {
  const tid = hostOwn(article, CaptureSelectors.FOLLOW_BUTTON)?.getAttribute("data-testid");
  const m = tid ? FOLLOW_BUTTON_USER_ID_RE.exec(tid) : null;
  return m ? (m[1] as string) : undefined;
}

function readText(article: Element): string | undefined {
  const node = hostOwn(article, Selectors.TWEET_TEXT);
  return node ? readCollapsedText(node) : undefined;
}

/**
 * Normalized to a UTC ISO instant: a durable record has to be comparable across
 * posts weeks later, which a raw attribute string in whatever offset X rendered
 * is not. An unparseable datetime degrades to no posted-at.
 */
function readPostedAt(article: Element): string | undefined {
  const raw = hostOwn(article, CaptureSelectors.TIMESTAMP)?.getAttribute("datetime");
  if (!raw) return undefined;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** Kind + a URL REFERENCE the article already exposes. Nothing is fetched. */
function readMedia(article: Element): TweetCapture["media"] {
  const out: TweetCapture["media"] = [];
  for (const el of article.querySelectorAll(MEDIA)) {
    if (!isHostOwn(el, article)) continue;
    if (el.matches(FacetSelectors.VIDEO)) out.push(mediaEntry("video", videoUrl(el)));
    // One media item is one entry: a photo node nested in a player is that
    // video's still, not a second attachment.
    else if (!el.closest(FacetSelectors.VIDEO)) out.push(mediaEntry("photo", photoUrl(el)));
  }
  return out;
}

function mediaEntry(kind: MediaKind, url: string | undefined): TweetCapture["media"][number] {
  return url ? { kind, url } : { kind };
}

function photoUrl(el: Element): string | undefined {
  return el.querySelector(CaptureSelectors.MEDIA_IMG)?.getAttribute("src") ?? undefined;
}

function videoUrl(el: Element): string | undefined {
  return (
    el.querySelector(CaptureSelectors.VIDEO_POSTER)?.getAttribute("poster") ??
    el.querySelector(CaptureSelectors.MEDIA_IMG)?.getAttribute("src") ??
    undefined
  );
}

export function capture(article: Element): TweetCapture {
  const pl = safe(() => readPermalink(article), null);
  const author = safe(() => readAuthor(article, pl?.screenName), undefined);
  const text = safe(() => readText(article), undefined);
  const media = safe(() => readMedia(article), []);
  const postedAt = safe(() => readPostedAt(article), undefined);

  return {
    statusId: pl?.tweetId ?? null,
    permalink: pl ? `https://x.com/${pl.screenName}/status/${pl.tweetId}` : null,
    ...(author ? { author } : {}),
    ...(text ? { text } : {}),
    media,
    ...(postedAt ? { postedAt } : {}),
  };
}
