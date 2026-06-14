# Task 006 — Timeline filter `decide` (test / Red)

- **type:** test
- **depends-on:** ["001"]
- **files:** `tests/core/timeline-filter.test.ts` (new)

## Contract under test

```ts
// src/core/timeline-filter.ts (impl in task 007)
import type { Facets, FilterState, FilterVerdict } from "@/core/filter-types";
export function decide(facets: Facets, state: FilterState): FilterVerdict;
```

## BDD Scenario

```gherkin
Scenario: Hide wins over everything
  Given state with criteria { "kind:video": "hide" }
  And facets for a video post
  Then decide returns "hide"

Scenario: Language gate hides a foreign language
  Given state { onlyMyLanguages: true, myLanguages: ["ja"] }
  And facets with lang "en"
  Then decide returns "hide"

Scenario: Language gate passes an undetectable language (fail-open)
  Given state { onlyMyLanguages: true, myLanguages: ["ja"] }
  And facets with lang null
  Then decide returns "show"

Scenario: Only is AND-across-families / OR-within-family
  Given state { onlyMyLanguages: true, myLanguages: ["ja"],
                criteria: { "linkDest:arxiv": "only", "linkDest:hn": "only" } }
  Then a Japanese arXiv-link post → "show"
  And  a Japanese YouTube-link post → "hide" (link family unsatisfied)
  And  an English arXiv-link post → "hide" (language gate)

Scenario: Empty-only shows
  Given state with no only/hide criteria and onlyMyLanguages false
  Then decide returns "show"

Scenario: Unclassified shows (fail-open)
  Given empty/partial facets (all false, lang null)
  And state with onlyMyLanguages false
  Then decide returns "show"
```

## Steps

1. Encode the §4 truth table as parameterized cases. Resolve `linkDest` from `facets.linkHosts` using `link-classifier` + `state.linkRules` (so this test also exercises the classifier integration).
2. Cover hide-wins precedence, the language gate (incl. undetectable=show), AND-across/OR-within, empty-only, and unclassified=show.

## Verification

- `bunx vitest run tests/core/timeline-filter.test.ts` runs and **fails** (Red).
