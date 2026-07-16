# Task 012 — Filter bar UI (test / Red)

- **type:** test
- **depends-on:** ["009"]
- **files:** `tests/ui/filter-bar.test.tsx` (new)

## Contract under test

```tsx
// src/ui/filter-bar.tsx (impl in task 013)
import type { FilterStore } from "@/core/filter-store";
export function FilterBar(props: { store: FilterStore; hiddenCount: () => number }): JSX.Element;
```

## BDD Scenario

```gherkin
Scenario: Renders family-grouped tri-state chips
  Given a FilterBar bound to a store
  Then it renders chips grouped by Family (Media kind, Link destination, Post role)
  And each chip reflects its mode (off / only / hide) with a distinct visual

Scenario: Cycling a chip updates the store
  Given a chip at "off"
  When the user clicks it
  Then store.cycle(id) is called and the chip advances to "only"

Scenario: Only-my-languages toggle
  Given the language group
  When the user toggles "only my languages"
  Then store.setOnlyMyLanguages(true) is called

Scenario: Hidden count + show-anyway + master toggle
  Given hiddenCount() returns 5
  Then the bar shows "5 hidden" with a "show anyway" control and a master on/off
```

## Steps

1. Use `@testing-library/preact` with a **fake/real `createFilterStore`** over fake storage.
2. Assert chip grouping, tri-state visual state, cycle-on-click wiring, language toggle, hidden-count line, master toggle.
3. (Route-gating and sticky placement are asserted at integration/e2e — tasks 016/017 — not here.)

## Verification

- `bunx vitest run tests/ui/filter-bar.test.tsx` runs and **fails** (Red).
