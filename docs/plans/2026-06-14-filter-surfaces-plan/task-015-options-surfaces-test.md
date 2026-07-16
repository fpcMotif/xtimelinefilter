# Task 015: Options surface + preset management — test (RED)

**depends-on**: _(none)_

## Description

Write a failing test for the Options-page additions: a **Surfaces** section (independent pill / palette / bar toggles + palette-hotkey field, bound to `LassoSettings`) and a **Presets** manager (list, rename, delete, bound to the filter store).

## Execution Context

**Task Number**: 015 of 017
**Phase**: Core Features (Phase 2)
**Prerequisites**: Existing `src/options/*` + `tests/options/*` patterns; settings + store mocks.

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

- Create: `tests/options/surface-options.test.tsx`

## Steps

### Step 1: Implement Test (Red)
- Render the not-yet-existing `SurfaceOptions` + `PresetManager` (from `@/options/SurfaceOptions`); assert toggle/hotkey → `settings.set` and rename/delete → store spies.
- Expected contract:
  ```tsx
  export function SurfaceOptions(props: { settings: SettingsStore }): JSX.Element;
  export function PresetManager(props: { store: FilterStore }): JSX.Element;
  ```
- **Verification**: Run test → MUST FAIL (components absent).

## Verification Commands

```bash
bunx vitest run tests/options/surface-options.test.tsx
```

## Success Criteria

- Test maps to the scenario and fails because the Options surface/preset components do not yet exist.
