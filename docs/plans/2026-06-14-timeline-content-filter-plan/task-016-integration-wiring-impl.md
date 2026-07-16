# Task 016 — Integration wiring in content/main.tsx

- **type:** impl
- **depends-on:** ["011", "013"]
- **files:** `src/content/main.tsx` (extend `start()`), small route helper (`src/content/route.ts`, new)

## BDD Scenario

```gherkin
Scenario: The scanner feeds the applier and the bar mounts in-scope
  Given Lasso starts on /home
  Then a FilterStore is created and loaded, a FilterApplier is created,
       the existing tweet-scanner callback also calls applier.classify(article),
       and the FilterBar mounts as a sticky bar under the For You/Following tab strip

Scenario: Overlay injection skips stubbed cells
  Given a cell the applier has stubbed
  When the scanner would inject the selection overlay
  Then injection is skipped (applier.isStubbed(cell) is true)

Scenario: Route changes re-evaluate scope
  Given the user navigates from /home to /explore (SPA, no reload)
  Then the FilterBar unmounts and the applier goes inert (restoreAll)
  And navigating to /i/lists/123 re-mounts the bar and resumes classification

Scenario: Filter shares Lasso's lifecycle
  Given an on-demand tab that has not been woken
  Then no FilterStore/applier/bar is created (the Filter is dormant with Lasso)
```

## Steps (what, not how)

1. Inside `start()` (after settings load): `createFilterStore()` + `await load()`, `createFilterApplier({ store, root: document, inScope })`.
2. Extend the existing `createTweetScanner(...)` callback so each scanned article also calls `applier.classify(article)`; guard `injectOverlay` with `!applier.isStubbed(cell)`.
3. Add `src/content/route.ts`: `isInScope(location)` (`/home`, `/i/lists/*`) and a route-change subscription (patch `history.pushState`/`popstate`) → on change, mount/unmount the FilterBar and call `applier.reapplyAll()` or `restoreAll()`.
4. Mount the FilterBar in the open Shadow DOM, docked sticky under the tab strip; subscribe `store.state` → `applier.reapplyAll()`.
5. Keep everything inside `start()` so on-demand dormancy (ADR-0006) leaves the Filter absent. **Touch nothing in the assign/undo/select paths.**

## Verification

- `bun run typecheck` + `bun run lint` clean.
- Existing suite still green: `bun run test`.
- Manual: load the built extension on a fixture/live `/home`, confirm bar mounts and classify runs (full live confirmation is task 018).
