# Task 008: Surface settings model — impl (GREEN)

**depends-on**: task-007

## Description

Add the surface-preference fields to `LassoSettings` and `DEFAULT_SETTINGS` so task-007 passes. Purely additive; the existing `createSettings` merge-over-defaults logic already handles migration of absent keys.

## Execution Context

**Task Number**: 008 of 017
**Phase**: Foundation (Phase 1)
**Prerequisites**: task-007 (failing test).

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

- Modify: `src/core/settings.ts` — extend `LassoSettings` + `DEFAULT_SETTINGS`.

## Contracts (signatures/types only — NO bodies)

```ts
export interface LassoSettings {
  /* …existing fields… */
  surfaces: { pill: boolean; palette: boolean; bar: boolean };
  pillPosition: { x: number; y: number };
  paletteHotkey: string;
}
// DEFAULT_SETTINGS additions: surfaces {pill:true,palette:false,bar:false},
// pillPosition {x:…,y:…} (sensible default offset from X's bottom-right docks),
// paletteHotkey "mod+shift+f"
```

## Steps

### Step 1: Implement Logic (Green)
- Add the three fields to the interface and defaults. Confirm `get()` merges nested `surfaces` correctly (note: the existing shallow `{...DEFAULT_SETTINGS, ...raw}` replaces `surfaces` wholesale — ensure the test's "absent keys → defaults" expectation matches; if partial-`surfaces` merge is required, deep-merge `surfaces` in `get()`).
- **Verification**: task-007 test PASSES.

### Step 2: Verify & Refactor
- Run the existing `settings.test.ts` to confirm no regression.

## Verification Commands

```bash
bunx vitest run tests/core/settings-surfaces.test.ts
bunx vitest run tests/core/settings.test.ts
bun run typecheck
```

## Success Criteria

- task-007 passes; existing settings tests still green; defaults + round-trip + migration verified.
