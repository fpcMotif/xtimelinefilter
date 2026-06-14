# Task 002: Presets store contract — impl (GREEN)

**depends-on**: task-001

## Description

Implement the named-presets contract so task-001 passes. Add the `FilterPreset` type and a `presets` field to `FilterState`, and the four preset methods to the store. Presets persist with the rest of `FilterState` under the existing `lasso:filter` key. Additive only — no change to `decide()` / engine.

## Execution Context

**Task Number**: 002 of 017
**Phase**: Core Features (Phase 1)
**Prerequisites**: task-001 (failing test) present.

## BDD Scenario

```gherkin
Scenario: Save, apply, and persist a named preset
  Given a filter store with kind:video set to "only" and onlyMyLanguages true
  When I call savePreset("Reading")
  Then a preset named "Reading" exists with a non-empty id
  And its snapshot captures criteria {kind:video: only} and onlyMyLanguages true
  When I clear all criteria and call applyPreset(thatId)
  Then the active criteria again contain kind:video "only" and onlyMyLanguages is true
  When a fresh store loads from the same storage area
  Then the "Reading" preset is present (storage.sync round-trip)
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§6, §8)

## Files to Modify/Create

- Modify: `src/core/filter-types.ts` — add the `FilterPreset` interface and `presets: FilterPreset[]` to `FilterState`.
- Modify: `src/core/filter-store.ts` — extend the `FilterStore` interface + `createFilterStore` with the four methods; default `presets: []`; ensure `load()` defaults a missing `presets` to `[]`.

## Contracts (signatures/types only — NO bodies)

```ts
// filter-types.ts
export interface FilterPreset {
  id: string;
  name: string;
  criteria: Record<CriterionId, FilterMode>;
  onlyMyLanguages: boolean;
  myLanguages?: string[];
}
export interface FilterState {
  /* …existing fields… */
  presets: FilterPreset[];
}

// filter-store.ts (added to FilterStore)
savePreset(name: string): string;     // snapshot current selection; returns new id (e.g. crypto.randomUUID())
applyPreset(id: string): void;        // replace criteria + onlyMyLanguages (+ myLanguages if captured)
renamePreset(id: string, name: string): void;
deletePreset(id: string): void;
```

## Steps

### Step 1: Implement Logic (Green)
- Add the type + field; seed `defaultState` with `presets: []`; merge-default `presets` on `load()`.
- Implement the four methods via the existing `update()` persistence path so they write through to `storage.sync`. `applyPreset` must NOT mutate `linkRules`.
- **Verification**: Run the task-001 test → it MUST PASS.

### Step 2: Verify & Refactor
- Run the full core suite to confirm no regression to existing filter-store behaviour.

## Verification Commands

```bash
bunx vitest run tests/core/filter-presets.test.ts
bunx vitest run tests/core/filter-store.test.ts
bun run typecheck
```

## Success Criteria

- task-001 suite passes; existing `filter-store.test.ts` still green.
- `linkRules` untouched by `applyPreset`; `presets` round-trips through the storage mock.
- No engine/`decide()` changes.
