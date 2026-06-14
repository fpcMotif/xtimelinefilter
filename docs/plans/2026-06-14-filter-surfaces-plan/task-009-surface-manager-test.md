# Task 009: Surface manager mount — test (RED)

**depends-on**: _(none)_

## Description

Write a failing test for `mountFilterSurfaces` — the manager that reads surface preferences and mounts each enabled in-page surface (pill / bar) into the Shadow DOM root, persists pill-position changes back to settings, and tears down when out of scope. The command palette's hotkey wiring is also owned here (verified at the manager level via the hotkey setting).

## Execution Context

**Task Number**: 009 of 017
**Phase**: Integration (Phase 1)
**Prerequisites**: happy-dom; fake `FilterStore` + `SettingsStore` + `hiddenCount`/`inScope` providers.

## BDD Scenario

```gherkin
Scenario: Manager mounts only the enabled in-page surfaces
  Given settings with surfaces { pill: true, palette: false, bar: false } and inScope true
  When mountFilterSurfaces runs
  Then a funnel pill is present in the root and no sticky bar is
  When the pill reports a new position
  Then settings.set is called with the new pillPosition
  Given settings change to surfaces { pill: false, bar: true }
  When the manager updates
  Then the pill is removed and a sticky bar is present
  Given inScope becomes false
  When the manager updates
  Then no filter surface remains mounted
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§3, §5, §7)

## Files to Modify/Create

- Create: `tests/content/surface-mount.test.ts`

## Steps

### Step 1: Implement Test (Red)
- Import the not-yet-existing `mountFilterSurfaces` from `@/content/surface-mount`.
- Mount into a detached element acting as the Shadow root; assert presence/absence of pill vs bar by `aria-label`/test id, position persistence, and scope teardown.
- Expected contract:
  ```ts
  export interface SurfaceMountDeps {
    root: ShadowRoot | Element;
    store: FilterStore;
    settings: SettingsStore;
    hiddenCount: () => number;
    inScope: () => boolean;
  }
  export function mountFilterSurfaces(deps: SurfaceMountDeps): { update(): void; unmount(): void };
  ```
- **Verification**: Run test → MUST FAIL (module absent).

## Verification Commands

```bash
bunx vitest run tests/content/surface-mount.test.ts
```

## Success Criteria

- Test maps to the scenario and fails because `surface-mount` does not yet exist.
