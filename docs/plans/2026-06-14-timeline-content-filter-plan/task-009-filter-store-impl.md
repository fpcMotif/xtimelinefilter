# Task 009 — Filter store (impl / Green)

- **type:** impl
- **depends-on:** ["008"]
- **files:** `src/core/filter-store.ts` (new)

## Contract

(See task 008 for the full `FilterStore` interface + `createFilterStore` factory.)

## BDD Scenario

```gherkin
Scenario: Default is a no-op with seeded languages
  Given a fresh store with navLanguages ["ja-JP","en-US"]
  Then enabled true, criteria empty, onlyMyLanguages false, myLanguages ["ja","en"]
```

## Steps (what, not how)

1. Implement `createFilterStore` with `@preact/signals-core` (mirror `core/settings.ts` + `core/selection-store.ts` patterns).
2. Persist `FilterState` to `storage.sync` under one key; debounce writes; `load()` hydrates and merges with defaults.
3. `cycle` advances the tri-state; setters update the relevant slice and persist.
4. Seed `myLanguages` from injected `navLanguages` (default `navigator.languages`), normalizing region tags (`ja-JP` → `ja`).
5. All storage access guarded — failures fall back to in-memory defaults, never throw (spec §8).

## Verification

- `bunx vitest run tests/core/filter-store.test.ts` **passes** (Green).
- `bun run typecheck` + `bun run lint` clean.
