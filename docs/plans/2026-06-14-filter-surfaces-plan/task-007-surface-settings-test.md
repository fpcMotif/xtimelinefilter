# Task 007: Surface settings model — test (RED)

**depends-on**: _(none)_

## Description

Write a failing test for the surface-preference additions to `LassoSettings`: independent per-surface toggles, the persisted pill position, and the palette hotkey. These drive the surface manager and the Options UI.

## Execution Context

**Task Number**: 007 of 017
**Phase**: Foundation (Phase 1)
**Prerequisites**: Existing `src/core/settings.ts` + its storage mock pattern (`tests/core/settings.test.ts`).

## BDD Scenario

```gherkin
Scenario: Surface preferences default and persist
  Given a fresh settings store
  Then surfaces equals { pill: true, palette: false, bar: false }
  And paletteHotkey defaults to a non-empty shortcut
  And pillPosition has numeric x and y
  When I set surfaces.palette to true and pillPosition to {x:40,y:120}
  Then a subsequent get() returns those values merged over defaults
  And reading a stored settings object lacking the new keys still yields the defaults (migration)
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§7, §8)

## Files to Modify/Create

- Create: `tests/core/settings-surfaces.test.ts` (separate from the foundation-owned `tests/core/settings.test.ts`).

## Steps

### Step 1: Implement Test (Red)
- Use the in-memory `StorageLike` mock; create the store via `createSettings(fakeStorage)`.
- Assert the defaults, set/get round-trip, and default-merge for absent keys — against fields that do not yet exist:
  ```ts
  surfaces: { pill: boolean; palette: boolean; bar: boolean };
  pillPosition: { x: number; y: number };
  paletteHotkey: string;
  ```
- **Verification**: Run test → MUST FAIL (fields absent from `DEFAULT_SETTINGS` / `LassoSettings`).

## Verification Commands

```bash
bunx vitest run tests/core/settings-surfaces.test.ts
```

## Success Criteria

- Test maps to the scenario and fails because the new settings fields do not yet exist.
