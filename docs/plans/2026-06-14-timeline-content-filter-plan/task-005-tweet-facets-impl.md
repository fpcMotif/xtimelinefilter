# Task 005 — Tweet facets (impl / Green)

- **type:** impl
- **depends-on:** ["004"]
- **files:** `src/core/tweet-facets.ts` (new)

## Contract

```ts
import type { Facets } from "@/core/filter-types";
export function extractFacets(article: Element): Facets;
```

## BDD Scenario

(Implements task 004's scenarios — see that file.) Key invariant:

```gherkin
Scenario: Fail-open on a malformed article
  Given an Element whose querySelector throws
  Then extractFacets returns partial Facets and does NOT throw
```

## Steps (what, not how)

1. Read presence flags via `FacetSelectors` (photo/video/card/quote) and `Selectors.TWEET_TEXT`; derive `hasText` and the independent predicates per spec §2.
2. Collect `linkHosts` from card + outbound anchors inside the status body (parse host robustly; ignore x.com internal links). Do **not** classify here — that's `link-classifier`, applied later with user rules.
3. Read `role` from `socialContext` (repost), `lang` from the `lang` attribute on `tweetText`.
4. **Wrap every read in try/catch** so any failure degrades to a partial `Facets` and never throws (fail-open). Pure, isolated-world-safe, no network.
5. Mirror `tweet-extractor.ts` style (pure, returns plain object).

## Verification

- `bunx vitest run tests/core/tweet-facets.test.ts` **passes** (Green).
- `bun run typecheck` + `bun run lint` clean.
- Selectors used here are listed for the task-018 live-DOM confirmation.
