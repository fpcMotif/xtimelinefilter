import { FacetSelectors, Selectors } from "@/content/selectors";
import type { Facets } from "@/core/filter-types";

import { isHostOwn } from "./dom";
import { safe } from "./guard";

/**
 * Pure, ISOLATED-world-safe extraction of a Tweet's Facets from its article.
 * Co-located sibling of author() under tweet-read. Every read is guarded so a
 * malformed/unexpected article degrades to partial Facets and NEVER throws
 * (fail-open, spec §8).
 *
 * The FacetSelectors it relies on are ASSUMPTIONS until confirmed on live x.com
 * (plan task 018 / verify-filter-dom.md).
 */

/** A full hostname (one or more labels + a TLD). */
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
/** x.com / twitter.com / t.co are internal — never an outbound destination. */
const INTERNAL_RE = /(?:^|\.)(?:x\.com|twitter\.com|t\.co)$/i;

/** Parse a host out of visible link text (X shows the real domain as the link's text). */
function hostFromText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const head = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .split(/[/?#\s]/);
  /* v8 ignore next -- split always yields >=1 element; ?? "" is a type-required, runtime-dead guard */
  const host = (head[0] ?? "").toLowerCase();
  return HOST_RE.test(host) ? host : null;
}

/** Host of an outbound href; null for internal/t.co (the real domain is in the text). */
function hostFromHref(href: string | null): string | null {
  /* v8 ignore next -- caller only feeds matched a[href^="http"] anchors; the null guard is unreachable */
  if (!href) return null;
  try {
    const host = new URL(href, "https://x.com").hostname.toLowerCase();
    return INTERNAL_RE.test(host) ? null : host;
  } catch {
    return null;
  }
}

/**
 * Outbound hosts for an article: from anchors (external href, else the t.co
 * anchor's visible text), plus a link card's vanity-domain element. Bare hosts;
 * link-classifier maps them to destinations.
 */
function collectLinkHosts(article: Element): string[] {
  const hosts = new Set<string>();
  for (const a of article.querySelectorAll(FacetSelectors.OUTBOUND_LINK)) {
    const fromHref = hostFromHref(a.getAttribute("href"));
    if (fromHref) hosts.add(fromHref);
    else {
      const fromText = hostFromText(a.textContent);
      if (fromText) hosts.add(fromText);
    }
  }
  const card = article.querySelector(FacetSelectors.CARD);
  if (card) {
    for (const el of card.querySelectorAll("span, div")) {
      const h = hostFromText(el.textContent);
      if (h) hosts.add(h);
    }
  }
  return [...hosts];
}

/* v8 ignore next 2 -- an Element's textContent is never null at runtime; ?? "" is a type-required guard */
const textOf = (el: Element): string => el.textContent ?? "";

export function facets(article: Element): Facets {
  const has = (sel: string): boolean => safe(() => !!article.querySelector(sel), false);
  // HOST-scoped variant: a match only counts when its NEAREST enclosing tweet is
  // THIS article — so a quoted post's own action bar can't leak its liked state
  // onto the host (facets §B1). Used only for the engagement read.
  const scopedHas = (sel: string): boolean =>
    safe(() => {
      const el = article.querySelector(sel);
      return !!el && isHostOwn(el, article);
    }, false);
  const tweetText = safe(() => article.querySelector(Selectors.TWEET_TEXT), null);

  const hasPhoto = has(FacetSelectors.PHOTO);
  const hasVideo = has(FacetSelectors.VIDEO);
  const hasQuote = has(FacetSelectors.QUOTE);
  const linkHosts = safe(() => collectLinkHosts(article), []);
  const hasCard = has(FacetSelectors.CARD);

  return {
    hasText: !!(tweetText && textOf(tweetText).trim()),
    hasPhoto,
    hasVideo,
    hasQuote,
    hasLink: hasCard || linkHosts.length > 0,
    linkHosts,
    role: has(Selectors.SOCIAL_CONTEXT) ? "repost" : null,
    lang: safe(() => tweetText?.getAttribute("lang") || null, null),
    liked: scopedHas(FacetSelectors.LIKED),
  };
}
