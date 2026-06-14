# Task 013: Extension popup panel — test (RED)

**depends-on**: _(none)_

## Description

Write a failing test asserting the toolbar extension popup (`PopupApp`) renders the shared `<FilterPanel>` over a store hydrated from `storage.sync`, so the user can toggle filters from the toolbar even when not focused on the X tab.

## Execution Context

**Task Number**: 013 of 017
**Phase**: Core Features (Phase 2)
**Prerequisites**: Existing `src/popup/PopupApp.tsx` + `tests/popup/PopupApp.test.tsx` pattern; storage mock.

## BDD Scenario

```gherkin
Scenario: Popup exposes the filter panel
  Given a popup mounted with a filter store hydrated from storage.sync
  Then the FilterPanel chips are rendered inside the popup
  When I click the "Video" chip
  Then store.cycle("kind:video") is invoked and persisted to storage.sync
  And a link to the Options page (for link rules / languages) is present
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§7)

## Files to Modify/Create

- Create: `tests/popup/PopupApp.filter.test.tsx`

## Steps

### Step 1: Implement Test (Red)
- Render `PopupApp` (extended to host `FilterPanel`) with a fake store; assert the chips render, a chip click cycles + persists, and an Options link exists.
- The popup passes no live `hiddenCount` (out-of-page) — assert the panel renders without a hidden-count/"show all" line in that mode.
- **Verification**: Run test → MUST FAIL (popup does not yet render FilterPanel).

## Verification Commands

```bash
bunx vitest run tests/popup/PopupApp.filter.test.tsx
```

## Success Criteria

- Test maps to the scenario and fails because the popup does not yet host `FilterPanel`.
