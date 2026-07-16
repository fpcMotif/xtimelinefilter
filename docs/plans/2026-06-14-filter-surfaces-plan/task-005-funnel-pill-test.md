# Task 005: Funnel pill + popover — test (RED)

**depends-on**: _(none)_

## Description

Write a failing component test for `<FunnelPill>` — the default surface: a floating funnel trigger with an active-criteria **badge** that opens the shared `<FilterPanel>` in a popover. Cover badge count, open/close, dim-when-disabled, applied position, and position-change persistence. (Live drag physics are verified by e2e task-017; here, simulate a position-change callback.)

## Execution Context

**Task Number**: 005 of 017
**Phase**: Core Features (Phase 1)
**Prerequisites**: `@testing-library/preact` + happy-dom.

## BDD Scenario

```gherkin
Scenario: Funnel pill badge, open/close, and disabled state
  Given a FunnelPill bound to a store with kind:video "only" and onlyMyLanguages true
  Then the pill shows a badge with count 2 (one active criterion + the language gate)
  And the popover (FilterPanel) is not visible
  When I click the pill
  Then the popover opens and renders the FilterPanel chips
  And the popover is anchored to the pill and flips to stay within the viewport
  When I press Escape (or click outside)
  Then the popover closes
  Given the store filter is disabled (enabled false)
  Then the pill is dimmed and shows no badge
```

**Closely-related assertions:** the pill renders at the provided `position`; a simulated move invokes `onPositionChange` with the new coordinates; the pill mounts inside its own positioned container with a z-index that does not overlap the selection `ActionBar` (spec §5 / §10 coexistence).

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§5)

## Files to Modify/Create

- Create: `tests/ui/funnel-pill.test.tsx`

## Steps

### Step 1: Implement Test (Red)
- Import the not-yet-existing `FunnelPill` (and a pure `activeCriteriaCount(state)` helper) from `@/ui/funnel-pill`.
- Assert badge count, open-on-click rendering of FilterPanel, close on Escape, dim+no-badge when disabled, applied position, and `onPositionChange`.
- Expected contract:
  ```tsx
  export function activeCriteriaCount(state: FilterState): number;
  export interface FunnelPillProps {
    store: FilterStore;
    hiddenCount: () => number;
    position: { x: number; y: number };
    onPositionChange: (pos: { x: number; y: number }) => void;
  }
  export function FunnelPill(props: FunnelPillProps): JSX.Element;
  ```
- **Verification**: Run test → MUST FAIL (component absent).

## Verification Commands

```bash
bunx vitest run tests/ui/funnel-pill.test.tsx
```

## Success Criteria

- Test maps to the scenario and fails because `FunnelPill` does not yet exist.
