# Task 007 — Timeline filter `decide` (impl / Green)

- **type:** impl
- **depends-on:** ["006", "003"]
- **files:** `src/core/timeline-filter.ts` (new)

## Contract

```ts
import type { Facets, FilterState, FilterVerdict } from "@/core/filter-types";
export function decide(facets: Facets, state: FilterState): FilterVerdict;
```

## BDD Scenario

(Implements task 006's scenarios.) Precedence order is load-bearing:

```gherkin
Scenario: Hide wins over everything
  Given criteria { "kind:video": "hide" } and a video post
  Then decide returns "hide"
```

## Steps (what, not how)

1. Implement the spec §4 algorithm in order: (1) hide-wins, (2) language gate, (3) only = AND-across-families / OR-within-family, (4) else show.
2. Map a Tweet's facets to the criterion space: `kind:*` from the `hasX` predicates; `linkDest:*` by classifying each `facets.linkHosts` entry via `classifyHost(host, state.linkRules)`; `role:repost` from `facets.role`.
3. Group active `only` criteria by `Family`; require at least one match per family that has any `only`.
4. Fail-open: partial/empty facets and the undetectable-language case resolve to `"show"`. Pure — no DOM, no I/O.

## Verification

- `bunx vitest run tests/core/timeline-filter.test.ts` **passes** (Green).
- `bun run typecheck` + `bun run lint` clean.
