# Task 013 — Filter bar UI (impl / Green)

- **type:** impl
- **depends-on:** ["012"]
- **files:** `src/ui/filter-bar.tsx` (new); minor style additions colocated

## Contract

```tsx
export function FilterBar(props: { store: FilterStore; hiddenCount: () => number }): JSX.Element;
```

## BDD Scenario

```gherkin
Scenario: Cycling a chip updates the store
  Given a chip at "off"
  When the user clicks it
  Then store.cycle(id) is called and the chip advances to "only"
```

## Steps (what, not how)

1. Render a compact, family-grouped tri-state chip bar bound to `store.state` signals (off / green-ring "only" / red-strike "hide"). The Language group is the single **"only my languages"** toggle.
2. Show a live "N hidden — show anyway" line and a master on/off. Respect `highContrast` like the rest of the UI.
3. Preact in the existing open Shadow DOM (ADR-0003); **no `innerHTML` of page data**. Placement (sticky under the tab strip) is handled by the mount in task 016 — keep the component placement-agnostic.

## Verification

- `bunx vitest run tests/ui/filter-bar.test.tsx` **passes** (Green).
- `bun run typecheck` + `bun run lint` clean.
