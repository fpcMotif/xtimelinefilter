# Task 017 — End-to-end filter flow (test)

- **type:** test
- **depends-on:** ["016"]
- **files:** `e2e/content.spec.ts` (extend — already exists), fixture timeline additions

## BDD Scenario

```gherkin
Scenario: Cycling a chip hides non-matching posts as stubs
  Given a fixture timeline with text, photo, video, arXiv-link, and Japanese posts
  And Lasso active on a /home-like route
  When the user sets "kind:video = hide"
  Then video-post cells collapse to the stub and the others stay full

Scenario: Show restores one; master off restores all
  Given some cells are stubbed
  When the user clicks a stub's "show"
  Then that one cell restores
  When the user toggles the master off
  Then every cell restores to the native feed

Scenario: only-my-languages narrows to the allowlist
  Given myLanguages ["ja"] and only-my-languages on
  Then English posts collapse to stubs and Japanese posts stay

Scenario: Invariant — List-assign is unaffected and X is never called
  Given the Filter is active and hiding posts
  Then select mode + assign + undo behave exactly as before
  And no network request to X originates from the filter path
```

## Steps

1. Extend the Playwright fixture timeline with posts of each facet (reuse the existing harness in `e2e/`).
2. Drive the filter bar (cycle chip, toggle language, show, master off) and assert stub/restore on the right `cellInnerDiv`s.
3. Add the **negative/invariant beat**: assert assign/undo/select still work with the filter on, and assert no X-bound request comes from the filter (mirrors the project's existing negative-beat discipline, e.g. `?caret=swallow`).

## Verification

- `bun run e2e` (or `bunx playwright test e2e/content.spec.ts`) passes, including the invariant beat.
