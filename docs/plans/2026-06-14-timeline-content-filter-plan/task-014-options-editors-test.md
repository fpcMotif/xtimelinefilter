# Task 014 — Options editors: My-languages + Link rules (test / Red)

- **type:** test
- **depends-on:** ["009"]
- **files:** `tests/options/filter-options.test.tsx` (new)

## Contract under test

```tsx
// src/options/* (impl in task 015)
export function MyLanguagesEditor(props: { store: FilterStore }): JSX.Element;
export function LinkRulesEditor(props: { store: FilterStore }): JSX.Element;
```

## BDD Scenario

```gherkin
Scenario: Edit the My-languages allowlist
  Given the My-languages editor bound to a store seeded ["ja","en"]
  When the user removes "en" and adds "ko"
  Then store.setMyLanguages(["ja","ko"]) is called and persisted

Scenario: Add a custom Link rule
  Given the Link rules editor
  When the user adds { host: "lobste.rs", dest: "article" }
  Then store.setLinkRules([...existing, rule]) is called and persisted

Scenario: Link rule validation
  Given the Link rules editor
  When the user enters a blank host or an invalid destination
  Then the rule is rejected and not persisted
```

## Steps

1. `@testing-library/preact` over a store backed by fake storage.
2. Assert add/remove for BCP-47 language chips and host→dest rules, plus validation rejection.

## Verification

- `bunx vitest run tests/options/filter-options.test.tsx` runs and **fails** (Red).
