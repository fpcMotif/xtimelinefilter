import type { LinkDest, LinkRule } from "@/core/filter-types";

/**
 * Built-in host → destination table. Any external host not matched here (and not
 * matched by a user rule) is the generic "article" (blog/news/other). Categories
 * are data, so v2 additions are purely additive.
 */
const DEFAULT_RULES: ReadonlyArray<{ host: string; dest: LinkDest }> = [
  { host: "arxiv.org", dest: "arxiv" },
  { host: "news.ycombinator.com", dest: "hn" },
  { host: "reddit.com", dest: "reddit" },
  { host: "youtube.com", dest: "youtube" },
  { host: "youtu.be", dest: "youtube" },
  { host: "github.com", dest: "github" },
];

/**
 * Hostname of the input, lowercased. Accepts a full URL ("https://arxiv.org/…")
 * or a bare host ("arxiv.org") — tweet-facets stores bare hosts. Null when neither.
 */
function hostOf(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  try {
    return new URL(s).hostname.toLowerCase();
  } catch {
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) ? s.toLowerCase() : null;
  }
}

/** Suffix match: "old.reddit.com" matches "reddit.com"; an exact host matches too. */
function matches(host: string, ruleHost: string): boolean {
  const s = ruleHost.toLowerCase();
  return host === s || host.endsWith(`.${s}`);
}

/**
 * Classify an outbound link by host. User rules win over the built-in defaults;
 * anything unmatched is "article". Pure, never throws (malformed input → "article").
 */
export function classifyHost(href: string, userRules: LinkRule[] = []): LinkDest {
  const host = hostOf(href);
  if (!host) return "article";
  for (const rule of userRules) {
    if (rule.host && matches(host, rule.host)) return rule.dest;
  }
  for (const rule of DEFAULT_RULES) {
    if (matches(host, rule.host)) return rule.dest;
  }
  return "article";
}
