# Task 015 — Options editors: My-languages + Link rules (impl / Green)

- **type:** impl
- **depends-on:** ["014"]
- **files:** `src/options/*` (new components + wiring into the existing Options page)

## Contract

```tsx
export function MyLanguagesEditor(props: { store: FilterStore }): JSX.Element;
export function LinkRulesEditor(props: { store: FilterStore }): JSX.Element;
```

## BDD Scenario

```gherkin
Scenario: Add a custom Link rule
  Given the Link rules editor
  When the user adds { host: "lobste.rs", dest: "article" }
  Then store.setLinkRules([...existing, rule]) is called and persisted
```

## Steps (what, not how)

1. Build the two editors as Preact components bound to `FilterStore`: a BCP-47 chip list (add/remove) for My-languages, and a host→destination table (add/remove/validate) for Link rules.
2. Mount them into the existing Options page (`src/options`) under a "Timeline Filter" section, following the page's existing layout/styles.
3. Validate input (non-blank host, destination ∈ `LinkDest`); reject invalid rules.
4. Persist via the same `filter-store`/`storage.sync` the in-feed bar reads — changes reflect live (verified in e2e/integration).

## Verification

- `bunx vitest run tests/options/filter-options.test.tsx` **passes** (Green).
- `bun run typecheck` + `bun run lint` clean.
