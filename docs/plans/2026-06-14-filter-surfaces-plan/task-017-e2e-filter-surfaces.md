# Task 017: End-to-end filter surfaces flow

**depends-on**: task-010, task-002

## Description

Add a Playwright e2e that drives the default surface end-to-end against the extension's timeline harness: open the funnel pill, set a criterion to "only", observe the feed collapse non-matching cells to the reversible stub, save a preset, reload, and confirm the preset persisted and re-applies. Follow the existing harness in `e2e/content.spec.ts` (fixture page + loaded extension; no live x.com dependency).

## Execution Context

**Task Number**: 017 of 017
**Phase**: Testing (Integration)
**Prerequisites**: task-010 (pill mounted via surface manager), task-002 (presets persist). Run after the implementations they verify are green.

## BDD Scenario

```gherkin
Scenario: Filter via the funnel pill end-to-end
  Given the extension is loaded on the timeline harness with several posts (some video, some not)
  When I click the funnel pill and set "Video" to "only"
  Then non-video cells collapse to a "· hidden — show" stub and video cells remain
  And the pill badge shows an active count
  When I save the current filter as a preset "Reading"
  And I reload the page
  Then the "Reading" preset is still present
  And applying it re-establishes "Video: only" and the same cells are hidden
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§5, §6, §9)

## Files to Modify/Create

- Create: `e2e/filter-surfaces.spec.ts`

## Steps

### Step 1: Verify Scenario
- Reuse `e2e/content.spec.ts` setup (extension load, fixture timeline, Shadow-DOM piercing helpers).

### Step 2: Implement Test
- Script the scenario: locate the pill in the Shadow root, open the popover, cycle "Video" to "only", assert stub presence on non-video cells, save preset, reload, assert preset persistence + re-apply.
- **Verification**: Run the e2e → it PASSES against the built extension.

### Step 3: Verify & Refactor
- Confirm the full unit suite still green; this task adds coverage only.

## Verification Commands

```bash
bun run build
bunx playwright test e2e/filter-surfaces.spec.ts
```

## Success Criteria

- The e2e passes: pill opens, "only" filtering collapses non-matching cells reversibly, preset saves, survives reload, and re-applies.
- No regressions in the unit suite (`bunx vitest run`).
