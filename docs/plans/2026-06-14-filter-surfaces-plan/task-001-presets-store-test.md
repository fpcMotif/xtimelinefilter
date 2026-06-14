# Task 001: Presets store contract — test (RED)

**depends-on**: _(none)_

## Description

Write a failing test suite for the **named presets** extension to `filter-store`. A preset is a named snapshot of the active filter *selection* (`criteria` + `onlyMyLanguages` + `myLanguages`); it does NOT capture `linkRules`. The store gains `savePreset`, `applyPreset`, `renamePreset`, `deletePreset`, and a `presets` field on `FilterState`.

## Execution Context

**Task Number**: 001 of 017
**Phase**: Core Features (Phase 1)
**Prerequisites**: Existing `src/core/filter-store.ts` and `src/core/filter-types.ts` (engine foundation, committed).

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

**Closely-related assertions to cover in the same suite (trivial variations of the same contract):**
- `renamePreset(id, "Focus")` changes only the name; `deletePreset(id)` removes it.
- A preset does NOT include `linkRules`; applying a preset leaves existing `linkRules` untouched.
- `load()` of a stored state lacking `presets` yields `presets: []` (migration / fail-open).

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§6, §8)

## Files to Modify/Create

- Create: `tests/core/filter-presets.test.ts` (new file — does not touch the existing `tests/core/filter-store.test.ts` owned by the foundation work)

## Steps

### Step 1: Verify Scenario
- Confirm the scenario above is represented; use the in-memory `StorageLike` mock pattern from `tests/core/filter-store.test.ts` / `tests/core/settings.test.ts` to isolate `chrome.storage` (test-double, no real storage).

### Step 2: Implement Test (Red)
- Create `tests/core/filter-presets.test.ts`.
- Build a store via `createFilterStore({ storage: fakeStorage, navLanguages: [...] })`.
- Assert against the contract additions (which do not yet exist), expecting these signatures on `FilterStore`:
  ```ts
  savePreset(name: string): string;          // returns the new preset id
  applyPreset(id: string): void;
  renamePreset(id: string, name: string): void;
  deletePreset(id: string): void;
  // and state.value.presets: FilterPreset[]
  ```
- **Verification**: Run the test → it MUST FAIL (compile error / missing method is acceptable as Red only if it then asserts behaviour; ensure at least one assertion fails meaningfully, e.g. `expect(store.state.value.presets).toHaveLength(1)`).

## Verification Commands

```bash
bunx vitest run tests/core/filter-presets.test.ts
```

## Success Criteria

- Test file exists and maps 1:1 to the scenario.
- Suite FAILS for the right reason (presets API/field absent), not an unrelated import error.
