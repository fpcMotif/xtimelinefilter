# Task 006: Funnel pill + popover — impl (GREEN)

**depends-on**: task-005, task-004

## Description

Implement `<FunnelPill>`: a draggable floating trigger that renders an active-criteria badge and toggles a popover hosting `<FilterPanel>`. Position comes from props and changes are reported via `onPositionChange` (the surface manager persists it to settings). Popover anchors to the pill, closes on Escape / outside-click, dims when the filter is disabled. No positioning of the bar here — this is the pill surface only.

## Execution Context

**Task Number**: 006 of 017
**Phase**: Core Features (Phase 1)
**Prerequisites**: task-005 (failing test), task-004 (FilterPanel).

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

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§5)

## Files to Modify/Create

- Create: `src/ui/funnel-pill.tsx`

## Contracts (signatures/types only — NO bodies)

```tsx
export function activeCriteriaCount(state: FilterState): number; // non-"off" criteria + (onlyMyLanguages ? 1 : 0)
export interface FunnelPillProps {
  store: FilterStore;
  hiddenCount: () => number;
  position: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
}
export function FunnelPill(props: FunnelPillProps): JSX.Element;
```

## Steps

### Step 1: Implement Logic (Green)
- Render the pill at `position` (fixed within the Shadow DOM root), with a badge from `activeCriteriaCount`.
- Pointer drag updates local position and reports via `onPositionChange`; clamp to viewport.
- Click toggles a popover that renders `<FilterPanel store hiddenCount />`, anchored to the pill and flipped to stay on-screen; close on Escape / outside-click; transition with `--ease-out`.
- When `state.enabled` is false: dim the pill and hide the badge.
- Mount the pill in its own positioned container with a z-index that does NOT overlap the selection `ActionBar` (spec §5 / §10 coexistence) — verify against `src/ui/ActionBar.tsx` anchoring.
- Honor `data-hc`; no `innerHTML` of page data.
- **Verification**: task-005 test PASSES.

### Step 2: Verify & Refactor
- Confirm FilterPanel test still green (shared component untouched in contract).

## Verification Commands

```bash
bunx vitest run tests/ui/funnel-pill.test.tsx
bunx vitest run tests/ui/filter-panel.test.tsx
bun run typecheck
```

## Success Criteria

- task-005 passes; badge math, open/close, disabled-dim, position + `onPositionChange` all verified.
