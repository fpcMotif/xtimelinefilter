# Task 003: Shared FilterPanel — test (RED)

**depends-on**: _(none)_

## Description

Write a failing component test for a new shared `<FilterPanel>` — the reusable filter body that every surface hosts. It renders the family-grouped tri-state cycle chips, a legend, the master toggle, the "only my languages" toggle, the "N hidden · show all" line, and a **presets row** (apply pill + save). It is placement-agnostic (no positioning).

## Execution Context

**Task Number**: 003 of 017
**Phase**: Core Features (Phase 1)
**Prerequisites**: `@testing-library/preact` + happy-dom (configured in `tests/setup.ts`).

## BDD Scenario

```gherkin
Scenario: FilterPanel reflects and mutates store state
  Given a FilterPanel bound to a filter store and a hiddenCount provider returning 3
  Then it renders a chip for each criterion grouped by family (Type, Links, Source) and a legend
  And it shows "3 hidden" with a "show all" affordance
  When I click the "Video" chip
  Then store.cycle("kind:video") is invoked (off → only) and the chip reflects the "only" state
  When the store has a preset "Reading"
  Then a "Reading" preset pill renders, and clicking it calls store.applyPreset(thatId)
  And a "save" affordance calls store.savePreset with the typed name
  When I toggle the master "Filter" checkbox off
  Then store.setEnabled(false) is invoked
  And clicking "show all" performs a temporary override without mutating stored criteria
```

**Preset scope in this surface:** the panel's presets row offers **apply + save only**. Rename/delete live in the Options `PresetManager` (task-016), not the popover — keeps the popover compact.

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§4)

## Files to Modify/Create

- Create: `tests/ui/filter-panel.test.tsx` (model it on `tests/ui/filter-bar.test.tsx`).

## Steps

### Step 1: Verify Scenario
- Reuse the render + fake-store helpers from `tests/ui/filter-bar.test.tsx` (a store stub exposing `state` signal + spy methods including `cycle`, `applyPreset`, `savePreset`).

### Step 2: Implement Test (Red)
- Import the not-yet-existing `FilterPanel` from `@/ui/filter-panel`.
- Assert chip rendering, the master + language toggles, the hidden-count line, and preset apply/save wiring.
- Expected contract:
  ```tsx
  export interface FilterPanelProps { store: FilterStore; hiddenCount?: () => number; }
  export function FilterPanel(props: FilterPanelProps): JSX.Element;
  ```
  When `hiddenCount` is omitted (e.g. the out-of-page popup), the panel renders without the "N hidden · show all" line — add an assertion covering that mode.
- **Verification**: Run test → MUST FAIL (module/component absent).

## Verification Commands

```bash
bunx vitest run tests/ui/filter-panel.test.tsx
```

## Success Criteria

- Test maps to the scenario and fails because `FilterPanel` does not yet exist.
