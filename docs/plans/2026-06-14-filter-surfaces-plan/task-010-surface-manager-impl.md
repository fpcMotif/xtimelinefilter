# Task 010: Surface manager mount — impl (GREEN)

**depends-on**: task-009, task-006, task-008

> **Coordination point:** edits `src/content/main.tsx`, shared with the concurrent foundation work (which wires the bar today). Rebase onto committed `main.tsx`; replace its direct bar mount with a call to `mountFilterSurfaces`.

## Description

Implement `mountFilterSurfaces` and wire it into `main.tsx`. It reads `settings.surfaces`, renders the enabled in-page surfaces (`FunnelPill` and/or `FilterBar`) into the Shadow DOM root, persists pill position via `settings.set({ pillPosition })`, re-evaluates on settings change and SPA route change, and tears everything down when `inScope()` is false. The command-palette hotkey + mount is **not** wired here — task-012 extends this manager (`surface-mount.ts`) to add it (keeps the Phase-2 palette out of the Phase-1 critical path).

## Execution Context

**Task Number**: 010 of 017
**Phase**: Integration (Phase 1)
**Prerequisites**: task-009 (failing test), task-006 (pill), task-008 (settings).

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

- Create: `src/content/surface-mount.ts`
- Modify: `src/content/main.tsx` — replace any direct filter-bar mount with `mountFilterSurfaces(...)`, passing the existing store, settings, applier `hiddenCount`, and the route `inScope` helper (`src/content/route.ts`).

## Contracts (signatures/types only — NO bodies)

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

## Steps

### Step 1: Implement Logic (Green)
- Render enabled surfaces (pill + bar); subscribe to `settings` + route changes to call `update()`; unmount on out-of-scope.
- Pill `onPositionChange` → `settings.set({ pillPosition })`.
- Leave a clean extension point for task-012 to add the palette hotkey/mount (e.g. an internal registry of surface renderers keyed by `surfaces` flags) — but do NOT implement palette here.
- **Verification**: task-009 test PASSES.

### Step 2: Verify & Refactor
- Run content + ui suites; confirm bar/applier behaviour unaffected.

## Verification Commands

```bash
bunx vitest run tests/content/surface-mount.test.ts
bunx vitest run tests/content tests/ui
bun run typecheck
```

## Success Criteria

- task-009 passes; pill/bar mount per settings; position persists; teardown on out-of-scope.
- `main.tsx` mounts surfaces via the manager without regressing existing content tests.
