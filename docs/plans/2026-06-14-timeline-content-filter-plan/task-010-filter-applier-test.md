# Task 010 — Filter applier (test / Red)

- **type:** test
- **depends-on:** ["001"]
- **files:** `tests/content/filter-applier.test.ts` (new)

## Contract under test

```ts
// src/content/filter-applier.ts (impl in task 011)
import type { FilterStore } from "@/core/filter-store";
export interface FilterApplier {
  classify(article: Element): void;     // decide + collapse/restore the article's cell
  reapplyAll(): void;                   // re-run over every in-scope cell on state change
  restoreAll(): void;                   // un-collapse everything (disable / route exit)
  hiddenCount(): number;
  isStubbed(cell: Element): boolean;    // for overlay-suppression check
}
export function createFilterApplier(deps: {
  store: FilterStore;
  root: Document | Element;
  inScope: () => boolean;               // route gate
}): FilterApplier;
```

## BDD Scenario

```gherkin
Scenario: Collapse a non-matching cell to the stub
  Given onlyMyLanguages true, myLanguages ["ja"] and an English-text cell
  When classify(article) runs
  Then the article's cellInnerDiv is collapsed to the "· hidden — show" stub (not display:none)

Scenario: Show restores a single post
  Given a stubbed cell
  When its "show" affordance is invoked
  Then that one cell restores to full height and content

Scenario: Re-classify on every scan — no cached verdict
  Given a cell that was hidden
  When classify runs again for an article representing a different Tweet
  Then the verdict is recomputed from the current facets (no stale hide)

Scenario: Restore-all on disable
  Given several stubbed cells
  When store.setEnabled(false) fires
  Then every previously hidden cell is restored

Scenario: Fail-open on extraction throw
  Given an article whose facet extraction throws
  When classify runs
  Then the cell is shown (never hidden)

Scenario: A stubbed cell is inert for List-assign
  Given a stubbed cell
  Then isStubbed(cell) is true so overlay injection is skipped and select-mode ignores it

Scenario: Inert off-route; re-evaluates on route change
  Given inScope() returns false
  When classify runs
  Then nothing is collapsed
  And when inScope() flips true and reapplyAll runs, classification resumes
```

## Steps

1. Use happy-dom: build a `cellInnerDiv` → `article[data-testid=tweet]` subtree per scenario.
2. Inject a **fake `FilterStore`** (test double) and a controllable `inScope`. Subscribe-on-change is exercised by toggling store state then asserting `reapplyAll`/`restoreAll` effects.
3. Assert the collapse uses the **stub** (measurable height marker / class), never `display:none` (ADR-0010), and that restore is exact.

## Verification

- `bunx vitest run tests/content/filter-applier.test.ts` runs and **fails** (Red).
