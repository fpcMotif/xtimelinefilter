# Task 014: Extension popup panel — impl (GREEN)

**depends-on**: task-013, task-004

> **Coordination point:** edits `src/popup/PopupApp.tsx` (shared with foundation popup work). Rebase first; add the filter section alongside existing popup content.

## Description

Extend `PopupApp` to create/hydrate a `filter-store` (`load()` from `storage.sync`) and render `<FilterPanel>` over it, plus a link to the Options page for deep config (link rules, languages). Reuse the shared panel — no duplicate chip logic.

## Execution Context

**Task Number**: 014 of 017
**Phase**: Core Features (Phase 2)
**Prerequisites**: task-013 (failing test), task-004 (FilterPanel).

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

- Modify: `src/popup/PopupApp.tsx` — instantiate + `load()` a filter store; render `<FilterPanel store />` (omit `hiddenCount`); add an Options-page link.

## Steps

### Step 1: Implement Logic (Green)
- Hydrate the store on mount; render the shared panel; link to Options.
- **Verification**: task-013 test PASSES.

### Step 2: Verify & Refactor
- Run existing `tests/popup/PopupApp.test.tsx` to confirm no regression to current popup content.

## Verification Commands

```bash
bunx vitest run tests/popup/PopupApp.filter.test.tsx
bunx vitest run tests/popup/PopupApp.test.tsx
bun run typecheck
```

## Success Criteria

- task-013 passes; existing popup test still green; chip click persists via the shared store.
