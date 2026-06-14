/**
 * Shared contracts for the Filter capability (Lasso's second capability — see
 * docs/CONTEXT.md "Filter terms" and the design spec
 * docs/superpowers/specs/2026-06-14-timeline-content-filter-design.md).
 *
 * Types only — no logic. The pure units (link-classifier, tweet-facets,
 * timeline-filter) and the filter-store consume these.
 */

/** Where an outbound link points, after classification. "article" = generic blog/news/other. */
export type LinkDest = "arxiv" | "hn" | "reddit" | "youtube" | "github" | "article";

/**
 * A Tweet's classifiable properties, read purely from its `article`. Independent
 * predicates, not one enum: a post can be photo AND quote AND carry a link.
 * `linkHosts` are RAW outbound hosts — classification (with user rules) happens later.
 */
export interface Facets {
  hasText: boolean;
  hasPhoto: boolean;
  hasVideo: boolean;
  hasQuote: boolean;
  hasLink: boolean;
  /** Raw outbound hosts (e.g. "arxiv.org"); classified later via link-classifier. */
  linkHosts: string[];
  /** v1: repost or not. Extend in v2 (reply/thread/pinned). */
  role: "repost" | null;
  /** BCP-47 code from the tweetText `lang` attribute; null when absent/undetectable. */
  lang: string | null;
}

/** Per-criterion tri-state. The UI chip cycles off → only → hide → off. */
export type FilterMode = "off" | "only" | "hide";

/** A criterion id is "family:value", e.g. "kind:video", "linkDest:arxiv", "role:repost". */
export type CriterionId = string;

/** The families a criterion can belong to. */
export type Family = "kind" | "linkDest" | "role" | "language";

/** A user-defined host → destination mapping, merged ahead of the built-in defaults. */
export interface LinkRule {
  host: string;
  dest: LinkDest;
}

/** The whole persisted filter configuration (one global filter in v1; storage.sync). */
export interface FilterState {
  enabled: boolean;
  criteria: Record<CriterionId, FilterMode>;
  /** When true, posts whose detected lang is outside `myLanguages` are hidden. */
  onlyMyLanguages: boolean;
  /** BCP-47 allowlist (base codes), default seeded from navigator.languages. */
  myLanguages: string[];
  /** User link rules, win over built-in defaults. */
  linkRules: LinkRule[];
}

export type FilterVerdict = "show" | "hide";
