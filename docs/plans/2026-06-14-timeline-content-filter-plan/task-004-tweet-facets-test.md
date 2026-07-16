# Task 004 — Tweet facets (test / Red)

- **type:** test
- **depends-on:** ["001"]
- **files:** `tests/core/tweet-facets.test.ts` (new), DOM fixtures inline or under `tests/core/fixtures/`

## Contract under test

```ts
// src/core/tweet-facets.ts (impl in task 005)
import type { Facets } from "@/core/filter-types";
export function extractFacets(article: Element): Facets;
```

## BDD Scenario

```gherkin
Scenario: Photo post
  Given a tweet article containing [data-testid="tweetPhoto"] and tweetText
  When extractFacets runs
  Then hasPhoto is true; hasVideo, hasQuote, hasLink are false; hasText is true

Scenario: Text-only is the derived predicate
  Given a tweet article with tweetText and no photo/video/card/quote
  When extractFacets runs
  Then hasText is true and hasPhoto/hasVideo/hasQuote/hasLink are all false

Scenario: Native video post
  Given a tweet article containing [data-testid="videoPlayer"]
  Then hasVideo is true

Scenario: Link card with outbound host
  Given a tweet whose card.wrapper links to https://news.ycombinator.com/item?id=1
  When extractFacets runs
  Then hasLink is true and linkHosts includes "news.ycombinator.com"

Scenario: Quote post
  Given a tweet article that nests another tweet article (quoted)
  Then hasQuote is true

Scenario: Language from tweetText lang attribute
  Given tweetText with lang="ja"
  Then facets.lang === "ja"
  And when no lang attribute is present, facets.lang === null

Scenario: Repost role
  Given a tweet with [data-testid="socialContext"] text indicating a repost
  Then facets.role === "repost"

Scenario: Fail-open on a malformed article
  Given an Element whose querySelector throws
  When extractFacets runs
  Then it returns a partial Facets object and does NOT throw
```

## Steps

1. Build minimal happy-dom fixtures for each scenario (article subtrees with the relevant `data-testid`s). **Fixtures must mirror real X structure, not our assumptions** — task 018 confirms them live (lessons/0002, verify-by-effect memory).
2. Write failing assertions for each scenario, including the fail-open case (use a proxy/element stub that throws).

## Verification

- `bunx vitest run tests/core/tweet-facets.test.ts` runs and **fails** (Red).
