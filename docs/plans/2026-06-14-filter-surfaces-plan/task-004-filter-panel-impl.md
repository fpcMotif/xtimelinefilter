# Task 004: Shared FilterPanel + bar refactor — impl (GREEN)

**depends-on**: task-003, task-002

> **Coordination point:** refactors `src/ui/filter-bar.tsx`, shared with the concurrent foundation work. Rebase onto the committed `filter-bar.tsx` before starting.

## Description

Create `<FilterPanel>` by extracting the chip/toggle/hidden-count markup currently inline in `filter-bar.tsx`, and add the **presets row** (apply pills + a save control using the task-002 API). Then refactor `filter-bar.tsx` to render `<FilterPanel>` so the bar and all future surfaces share one body. Keep the existing chip catalog, mode styling, and ARIA labels intact.

## Execution Context

**Task Number**: 004 of 017
**Phase**: Core Features (Phase 1)
**Prerequisites**: task-003 (failing panel test), task-002 (presets API).

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

**Preset scope in this surface:** the panel's presets row offers **apply + save only**. Rename/delete live in the Options `PresetManager` (task-016), not the popover.

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§4)

## Files to Modify/Create

- Create: `src/ui/filter-panel.tsx` — the shared body (chip catalog, legend, master + language toggles, hidden-count/"show all", presets row).
- Modify: `src/ui/filter-bar.tsx` — render `<FilterPanel>` (bar becomes a thin placement wrapper; the lowest-priority surface).

## Contracts (signatures/types only — NO bodies)

```tsx
export interface FilterPanelProps { store: FilterStore; hiddenCount?: () => number; }
export function FilterPanel(props: FilterPanelProps): JSX.Element;
```
When `hiddenCount` is omitted, do not render the "N hidden · show all" line (popup mode).

## Steps

### Step 1: Implement Logic (Green)
- Move the `FAMILIES` catalog + `CHIP_*` styling into `filter-panel.tsx`; render groups, legend (◯ off · ◉ only · ⊘ hide), master toggle, "only my languages", and `{hidden} hidden · show all`.
- Add a presets row: a pill per `state.presets` (click → `applyPreset(id)`), and a small save control (capture a name → `savePreset(name)`).
- Refactor `filter-bar.tsx` to delegate to `<FilterPanel>`; preserve its `FilterBarProps`.
- No `innerHTML` of page data (ADR-0003); honor `data-hc`.
- **Verification**: task-003 test PASSES.

### Step 2: Verify & Refactor
- Run the bar test to confirm the refactor kept its behaviour green.

## Verification Commands

```bash
bunx vitest run tests/ui/filter-panel.test.tsx
bunx vitest run tests/ui/filter-bar.test.tsx
bun run typecheck
```

## Success Criteria

- task-003 passes; `filter-bar.test.tsx` still passes after the refactor.
- Chip catalog, mode styling, and ARIA labels unchanged.
