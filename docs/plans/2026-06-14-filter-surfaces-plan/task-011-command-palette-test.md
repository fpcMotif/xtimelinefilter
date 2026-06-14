# Task 011: Command palette — test (RED)

**depends-on**: _(none)_

## Description

Write a failing test for `<FilterPalette>` and its pure item builder. The palette is a centered overlay whose query fuzzy-matches across filter criteria, saved presets, and global actions; selecting an item mutates the store; Escape closes.

## Execution Context

**Task Number**: 011 of 017
**Phase**: Core Features (Phase 2)
**Prerequisites**: happy-dom; fake store with `presets`, `setMode`/`cycle`, `applyPreset`, `setEnabled` spies.

## BDD Scenario

```gherkin
Scenario: Palette fuzzy-matches and applies items
  Given a store with a preset "Reading" and a FilterPalette opened
  When I type "vid"
  Then an item "Only · video" is offered
  And selecting it sets kind:video to "only" on the store
  When I type "read"
  Then the "Reading" preset is offered, and selecting it calls applyPreset(thatId)
  When I type "show all"
  Then a "Show all hidden" action is offered that disables the filter on select
  When I press Escape
  Then onClose is invoked
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§7)

## Files to Modify/Create

- Create: `tests/ui/filter-palette.test.tsx`

## Steps

### Step 1: Implement Test (Red)
- Import the not-yet-existing `FilterPalette` + pure `buildPaletteItems(state)` from `@/ui/filter-palette`.
- Assert item generation (criteria × {only,hide} + presets + actions), the fuzzy filter, the apply side-effects, and Escape→`onClose`.
- Expected contract:
  ```tsx
  export interface PaletteItem { id: string; label: string; run(store: FilterStore): void; }
  export function buildPaletteItems(state: FilterState): PaletteItem[];
  export interface FilterPaletteProps { store: FilterStore; open: boolean; onClose: () => void; }
  export function FilterPalette(props: FilterPaletteProps): JSX.Element | null;
  ```
- **Verification**: Run test → MUST FAIL (module absent).

## Verification Commands

```bash
bunx vitest run tests/ui/filter-palette.test.tsx
```

## Success Criteria

- Test maps to the scenario and fails because `filter-palette` does not yet exist.
