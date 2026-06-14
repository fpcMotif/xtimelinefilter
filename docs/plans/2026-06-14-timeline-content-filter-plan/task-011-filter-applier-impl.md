# Task 011 — Filter applier (impl / Green)

- **type:** impl
- **depends-on:** ["010", "005", "007", "009"]
- **files:** `src/content/filter-applier.ts` (new)

## Contract

(See task 010 for `FilterApplier` + `createFilterApplier`.)

## BDD Scenario

```gherkin
Scenario: Re-classify on every scan — no cached verdict
  Given a cell that was hidden
  When classify runs again for an article representing a different Tweet
  Then the verdict is recomputed from current facets (no stale hide)
```

## Steps (what, not how)

1. `classify(article)`: if `!inScope()` or `!store.state.enabled`, ensure the cell is restored and return. Else `extractFacets(article)` → `decide(facets, store.state)`; on `"hide"` collapse the cell (`Selectors.CELL` ancestor) to the reversible stub, on `"show"` restore. **Never cache the verdict on the node** — recompute every call.
2. Collapse = add a marker class + minimal-height stub element holding "· hidden — show" wired to restore just that cell. Restore = remove marker + stub. The applier only ever toggles this state (ADR-0010); it never removes nodes or edits X-owned content.
3. `reapplyAll()` walks `root.querySelectorAll(Selectors.CELL)` (or TWEET → closest CELL) and re-runs `classify`. Subscribe to `store.state` changes → `reapplyAll`. `restoreAll()` un-collapses everything; called on disable and route exit.
4. Track `hiddenCount`; expose `isStubbed(cell)` so overlay injection (task 016) can skip stubbed cells.
5. Guard every DOM write; a throw on one cell never aborts the batch; extraction throw → show (fail-open).
6. Breakage-health hook (spec §7): if an implausible fraction of cells classify identically, surface a signal and bias toward showing.

## Verification

- `bunx vitest run tests/content/filter-applier.test.ts` **passes** (Green).
- `bun run typecheck` + `bun run lint` clean.
