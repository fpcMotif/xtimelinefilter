# Task 001 — Shared Filter types + FacetSelectors

- **type:** setup
- **depends-on:** []
- **files:**
  - `src/core/filter-types.ts` (new)
  - `src/content/selectors.ts` (extend: add `FacetSelectors`)

## Goal

Define the contracts every later task depends on: the `Facets` shape, the tri-state mode, `FilterState`, link types, and the centralized `FacetSelectors` table (ADR-0004 — the one place to fix on an X redesign). **No logic bodies** — types and a selector table only.

## Contract (types only — no implementation)

```ts
// src/core/filter-types.ts
export type LinkDest = "arxiv" | "hn" | "reddit" | "youtube" | "github" | "article";

export interface Facets {
  hasText: boolean;
  hasPhoto: boolean;
  hasVideo: boolean;
  hasQuote: boolean;
  hasLink: boolean;
  linkHosts: string[];        // raw outbound hosts; classified later with user rules
  role: "repost" | null;      // v1; extend in v2
  lang: string | null;        // BCP-47, read from tweetText lang attr
}

export type FilterMode = "off" | "only" | "hide";
export type CriterionId = string;          // e.g. "kind:video", "linkDest:arxiv", "role:repost"
export type Family = "kind" | "linkDest" | "role" | "language";
export interface LinkRule { host: string; dest: LinkDest; }

export interface FilterState {
  enabled: boolean;
  criteria: Record<CriterionId, FilterMode>;
  onlyMyLanguages: boolean;
  myLanguages: string[];      // BCP-47 allowlist
  linkRules: LinkRule[];      // user rules, merged ahead of defaults
}

export type FilterVerdict = "show" | "hide";
```

```ts
// src/content/selectors.ts — ADD (reuse existing TWEET/CELL/SOCIAL_CONTEXT/TWEET_TEXT where present)
export const FacetSelectors = {
  PHOTO: '[data-testid="tweetPhoto"]',
  VIDEO: '[data-testid="videoPlayer"], [data-testid="videoComponent"]',
  CARD: '[data-testid="card.wrapper"]',
  QUOTE: '[data-testid="tweet"] [data-testid="tweet"]',  // AMBER — verify live (task 018)
  OUTBOUND_LINK: 'a[href^="http"]',
} as const;
```

## Steps (what, not how)

1. Create `src/core/filter-types.ts` with the types above. No runtime values except `LinkDest` default mapping if needed (keep mapping in link-classifier, not here).
2. Add `FacetSelectors` to `src/content/selectors.ts`, reusing `Selectors.CELL`, `Selectors.SOCIAL_CONTEXT`, `Selectors.TWEET_TEXT` rather than duplicating. Mark `QUOTE` with an "AMBER — verify live" comment.
3. Do not implement any classifier/extractor logic here.

## Verification

- `bun run typecheck` passes.
- `bun run lint` clean.
- A throwaway import of every new type/selector compiles (the later test tasks consume them).
