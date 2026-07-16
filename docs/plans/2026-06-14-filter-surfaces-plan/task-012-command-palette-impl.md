# Task 012: Command palette — impl (GREEN)

**depends-on**: task-011, task-002, task-008, task-010

## Description

Implement `<FilterPalette>` and `buildPaletteItems`. The builder produces items for each criterion (an "Only ·" and a "Hide ·" entry), each saved preset (apply), and global actions ("Show all hidden", "Disable filter", "Enable filter"). The component renders a centered overlay with a fuzzy-filtered list; Enter runs the highlighted item; Escape calls `onClose`; the overlay stays open after applying for rapid multi-toggle.

## Execution Context

**Task Number**: 012 of 017
**Phase**: Core Features (Phase 2)
**Prerequisites**: task-011 (failing test), task-002 (presets API), task-008 (hotkey setting — consumed by the manager).

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

Scenario: Configured hotkey opens the palette via the surface manager
  Given surfaces.palette is enabled and paletteHotkey is "mod+shift+f"
  When that key combination is dispatched on the page
  Then the surface manager mounts/opens the FilterPalette overlay
  And disabling surfaces.palette removes the hotkey listener
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§7)

## Files to Modify/Create

- Create: `src/ui/filter-palette.tsx`
- Modify: `src/content/surface-mount.ts` — register/teardown a `paletteHotkey` keydown listener and mount/toggle `<FilterPalette>` when `surfaces.palette` (extends the task-010 manager; this is why task-012 depends on task-010).
- Modify: `tests/content/surface-mount.test.ts` — add the hotkey-opens-palette assertions (Red → Green within this task).

## Contracts (signatures/types only — NO bodies)

```tsx
export interface PaletteItem { id: string; label: string; run(store: FilterStore): void; }
export function buildPaletteItems(state: FilterState): PaletteItem[];
export interface FilterPaletteProps { store: FilterStore; open: boolean; onClose: () => void; }
export function FilterPalette(props: FilterPaletteProps): JSX.Element | null;
```

## Steps

### Step 1: Implement Logic (Green)
- Implement `buildPaletteItems` (pure): criteria entries, preset entries, action entries; stable ids/labels.
- Render the overlay (Shadow-DOM friendly), input, fuzzy-filtered list, keyboard nav; Enter → `item.run(store)` (stay open); Escape / outside → `onClose`.
- Honor `data-hc`; no `innerHTML` of page data.
- **Verification**: task-011 test PASSES.

### Step 2: Wire the hotkey into the manager (Red → Green)
- Add the hotkey-opens-palette assertions to `tests/content/surface-mount.test.ts` → run, MUST FAIL.
- Extend `src/content/surface-mount.ts` to register the `paletteHotkey` listener and mount/toggle `<FilterPalette>` when `surfaces.palette`; teardown on disable / out-of-scope.
- **Verification**: the surface-mount suite PASSES.

### Step 3: Verify & Refactor
- Re-run the full content + ui suites to confirm no regression.

## Verification Commands

```bash
bunx vitest run tests/ui/filter-palette.test.tsx
bunx vitest run tests/content/surface-mount.test.ts
bun run typecheck
```

## Success Criteria

- task-011 passes; fuzzy match, apply side-effects, and Escape→close all verified.
- The configured hotkey opens the palette via the manager; disabling `surfaces.palette` removes the listener.
