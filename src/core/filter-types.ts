/**
 * Shared contracts for the Filter capability (Lasso's second capability — see
 * docs/CONTEXT.md "Filter terms" and the design spec
 * docs/superpowers/specs/2026-06-14-timeline-content-filter-design.md).
 *
 * Types only — no logic. The pure units (link-classifier, tweet-read,
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
  /**
   * Whether the Owner has liked this post, read HOST-SCOPED & fail-open from the
   * live action bar (the `like` → `unlike` testid flip, verified live 2026-06-27).
   * A quoted post's own action bar must NOT leak onto the host — see facets.ts
   * `scopedHas`. (Bookmarked is intentionally absent: this X build renders no
   * bookmark button inline, so there is no DOM signal — see the design spec.)
   */
  liked: boolean;
}

/** Per-criterion tri-state. The UI chip cycles off → only → hide → off. */
export type FilterMode = "off" | "only" | "hide";

/** A criterion id is "family:value", e.g. "kind:video", "linkDest:arxiv", "role:repost". */
export type CriterionId = string;

/** The families a criterion can belong to. */
export type Family = "kind" | "linkDest" | "role" | "language" | "engagement";

/** A user-defined host → destination mapping, merged ahead of the built-in defaults. */
export interface LinkRule {
  host: string;
  dest: LinkDest;
}

/**
 * A named snapshot of the active filter *selection*: tri-state criteria plus the
 * language gate. Deliberately excludes `linkRules` — applying a preset never
 * touches the user's host→destination mappings. `myLanguages` is optional so a
 * preset may capture the allowlist or leave it as-is.
 */
export interface FilterPreset {
  id: string;
  name: string;
  criteria: Record<CriterionId, FilterMode>;
  onlyMyLanguages: boolean;
  myLanguages?: string[];
}

/**
 * The whole persisted filter configuration (storage.sync). One shared selection,
 * plus per-scope overrides: a scope named in `scopeBindings` carries its own
 * preset, and every other scope uses the shared one (spec #31).
 */
export interface FilterState {
  enabled: boolean;
  criteria: Record<CriterionId, FilterMode>;
  /** When true, posts whose detected lang is outside `myLanguages` are hidden. */
  onlyMyLanguages: boolean;
  /** BCP-47 allowlist (base codes), default seeded from navigator.languages. */
  myLanguages: string[];
  /** User link rules, win over built-in defaults. */
  linkRules: LinkRule[];
  /** Named selection snapshots (criteria + language gate; never linkRules). */
  presets: FilterPreset[];
  /**
   * When true, filtered posts collapse to 0 height with no "· hidden — show"
   * stub, for a clean feed. Default false — the safe stub mode (ADR-0010); the
   * 0-height mode is the deferred, virtualization-risky upgrade and is opt-in
   * (popup toggle), pending live-DOM verification.
   */
  compactHidden: boolean;
  /**
   * Which preset each bindable scope carries, keyed by {@link FilterScopeKey}
   * (spec #31). A binding stores only the preset's id — it is a pointer into
   * `presets`, never a second copy of the criteria — so a renamed or edited
   * preset stays in sync everywhere it is bound. A scope with no entry uses the
   * shared selection above, which is every scope's behavior before #31.
   */
  scopeBindings: Record<FilterScopeKey, string>;
}

export type FilterVerdict = "show" | "hide";

/**
 * Which timeline the user is on, resolved from the path by `content/route.ts`.
 * Distinct from the *Filter scope* of docs/CONTEXT.md, which names the whole set
 * of timelines the Filter may run on; this is one member of that set, identified.
 *
 * Home, List, and profile are bindable — each can carry its own preset (spec
 * #31). Bookmarks and History run the Filter but cannot yet be bound, so they
 * have no {@link FilterScopeKey}.
 */
export type FilterScope =
  | { readonly kind: "home" }
  | { readonly kind: "list"; readonly listId: string }
  | { readonly kind: "bookmarks" }
  | { readonly kind: "history" }
  | { readonly kind: "profile"; readonly handle: string };

/**
 * The stable string a scope's preset binding is stored under: `home`,
 * `list:<listId>`, or `profile:<handle>` with the handle case-folded.
 */
export type FilterScopeKey = string;
