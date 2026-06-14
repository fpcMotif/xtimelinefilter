# Task 018: Live-DOM verification on real x.com

**depends-on**: task-010, task-017

## Description

Verify-by-effect on the **real** x.com timeline (not a fixture) that the default surface works end-to-end against live DOM — the discipline the engine spec mandates (task-018 there) and that prior DOM-automation lessons demand (live ground truth, not fantasy fixtures). This is a manual/observed verification with a recorded result, not an automated assertion.

## Execution Context

**Task Number**: 018 of 018
**Phase**: Verification (Live)
**Prerequisites**: task-010 (pill mounts via the manager) and task-017 (fixture e2e green) are complete; a built extension loaded in a Chromium profile signed into X.

## BDD Scenario

```gherkin
Scenario: Funnel pill filters the live timeline
  Given the built extension is loaded and I am on https://x.com/home with a populated feed
  Then the funnel pill is visible and does not overlap X's compose/DM docks or the selection ActionBar
  When I open the pill and set "Video" to "only"
  Then non-video cells collapse to the reversible "· hidden — show" stub and video posts remain, while scrolling/virtualization stays intact
  When I save a preset, reload x.com, and re-open the pill
  Then the preset persists and re-applies, and the badge count is correct
  And toggling the master switch off instantly restores the native feed
```

**Spec Source**: `../../superpowers/specs/2026-06-14-filter-surfaces-design.md` (§11 — live DOM verification; §5 coexistence)

## Files to Modify/Create

- Create/Append: `lessons/learning-records/` entry (or the project's live-verification log) recording what was observed on live x.com — selector hits/misses, any DOM drift, screenshots/notes. No production code is the deliverable here; findings feed back into selectors/tasks if drift is found.

## Steps

### Step 1: Build + load
- `bun run build`; load the unpacked extension in a Chromium profile signed into X.

### Step 2: Observe (verify-by-effect)
- Walk the scenario on `https://x.com/home` and at least one `https://x.com/i/lists/*`. Confirm each Then by direct observation (DevTools + visual), not by assuming.

### Step 3: Record + reconcile
- Log results. If live DOM diverges from the fixtures (selectors, stub behaviour, virtualization), open follow-up fixes against `src/content/selectors.ts` / the relevant task rather than silently passing.

## Verification Commands

```bash
bun run build
# then manual load + live observation per Steps above
```

## Success Criteria

- The pill is visible, collision-free, and filters the live feed reversibly; presets persist across reload; master toggle restores the native feed.
- A live-verification record exists; any selector/DOM drift is filed as follow-up, not glossed over.
