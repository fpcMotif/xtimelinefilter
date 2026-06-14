# Task 016: Options surface + preset management — impl (GREEN)

**depends-on**: task-015, task-008, task-002

> **Coordination point:** edits `src/options/OptionsApp.tsx` (shared with the foundation FilterOptions wiring). Rebase first; add the new sections beside the existing My-languages / Link-rules editors.

## Description

Implement `SurfaceOptions` (pill / palette / bar toggles + palette-hotkey input, bound to `LassoSettings`) and `PresetManager` (list presets with rename + delete, bound to the filter store), and mount them in `OptionsApp` alongside the existing filter editors.

## Execution Context

**Task Number**: 016 of 017
**Phase**: Core Features (Phase 2)
**Prerequisites**: task-015 (failing test), task-008 (settings fields), task-002 (presets API).

## BDD Scenario

```gherkin
Scenario: Options manages surfaces and presets
  Given the Options Surfaces section bound to a settings store (pill on, palette off, bar off)
  When I toggle "Command palette" on
  Then settings.set is called with surfaces.palette = true
  When I change the palette hotkey field
  Then settings.set is called with the new paletteHotkey
  Given a Presets manager bound to a store containing preset "Reading"
  When I rename it to "Focus"
  Then store.renamePreset is called with that id and "Focus"
  When I delete it
  Then store.deletePreset is called with that id
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§6, §7)

## Files to Modify/Create

- Create: `src/options/SurfaceOptions.tsx` — exports `SurfaceOptions` + `PresetManager`.
- Modify: `src/options/OptionsApp.tsx` — render both, beside the existing `MyLanguagesEditor` / `LinkRulesEditor`.

## Contracts (signatures/types only — NO bodies)

```tsx
export function SurfaceOptions(props: { settings: SettingsStore }): JSX.Element;
export function PresetManager(props: { store: FilterStore }): JSX.Element;
```

## Steps

### Step 1: Implement Logic (Green)
- `SurfaceOptions`: three toggles → `settings.set({ surfaces: {...} })`; hotkey text field → `settings.set({ paletteHotkey })`.
- `PresetManager`: list `store.state.presets`; rename → `renamePreset`; delete → `deletePreset`.
- Follow the existing Options styling/labels (reuse `FilterOptions.tsx` class constants where reasonable).
- **Verification**: task-015 test PASSES.

### Step 2: Verify & Refactor
- Run existing Options tests to confirm no regression.

## Verification Commands

```bash
bunx vitest run tests/options/surface-options.test.tsx
bunx vitest run tests/options
bun run typecheck
```

## Success Criteria

- task-015 passes; existing Options tests still green; toggles/hotkey persist; rename/delete call the store.
