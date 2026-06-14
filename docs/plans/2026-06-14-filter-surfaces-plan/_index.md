# Filter Surfaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Load `superpowers:executing-plans` skill using the Skill tool to implement this plan task-by-task.

**Goal:** Turn the timeline content filter into a configurable, multi-surface UI — a default floating funnel pill + popover, named presets, a command palette, and an extension-popup view — all thin views over the existing `filter-store`.

**Architecture:** One engine, many views. The engine (`tweet-facets` → `timeline-filter.decide()` → `filter-applier`) and `filter-store` are unchanged except for an additive **presets** API. A shared `<FilterPanel>` component is extracted from the already-built `filter-bar.tsx` and reused by every surface. A small **surface manager** in `main.tsx` mounts whichever in-page surfaces the user enabled in settings (funnel pill on by default).

**Tech Stack:** Preact 10 + `@preact/signals`, Tailwind 4, Vite 8 + `@crxjs/vite-plugin` (Manifest V3), open Shadow DOM, Vitest 4 + `@testing-library/preact` + happy-dom, Playwright (e2e). Package manager: bun/bunx.

**Design Support:**
- [Spec: Filter Surfaces](../../superpowers/specs/2026-06-14-filter-surfaces-design.md)
- [Spec: Timeline Content Filter (engine + semantics)](../../superpowers/specs/2026-06-14-timeline-content-filter-design.md)

## Context

The filter **engine** is done and committed (`link-classifier`, `tweet-facets`, `timeline-filter`, `filter-store`, `filter-applier`). A concurrent effort on this same branch has additionally built the **single-surface foundation** (uncommitted at plan time, treated here as the base this plan extends):

- `src/ui/filter-bar.tsx` — family-grouped tri-state chips + master toggle + "only my languages" + hidden-count/"show all".
- `src/options/FilterOptions.tsx` — `MyLanguagesEditor` + `LinkRulesEditor`.
- `src/content/route.ts` — route scope helper; `main.tsx` / `OptionsApp.tsx` wiring.

This plan does **not** rebuild any of that. It adds the multi-surface layer on top. Because `filter-bar.tsx`, `main.tsx`, and `OptionsApp.tsx` are shared with the concurrent effort, tasks touching them are flagged as **coordination points** and must rebase onto the committed foundation before starting.

| Aspect | Current State | Target State |
|--------|--------------|--------------|
| Surfaces | One sticky chip bar (`filter-bar.tsx`) | Funnel pill (default) + palette + popup + bar, independently toggleable |
| Chip UI ownership | Inline in `filter-bar.tsx` | Extracted into shared `<FilterPanel>`; bar consumes it |
| Filter memory | One global filter | One global filter **+ named presets** |
| Surface choice | None (bar always mounts) | `surfaces` prefs in `LassoSettings`; surface manager mounts enabled ones |
| Trigger | Bar pinned under tabs | Draggable floating funnel pill (persisted position) opening the popover |
| Out-of-page control | Options editors only | Extension popup renders `<FilterPanel>`; command-palette hotkey overlay |

## Execution Plan

```yaml
tasks:
  - id: "001"
    subject: "Presets store contract — test"
    slug: "presets-store-test"
    type: "test"
    depends-on: []
  - id: "002"
    subject: "Presets store contract — impl"
    slug: "presets-store-impl"
    type: "impl"
    depends-on: ["001"]
  - id: "003"
    subject: "Shared FilterPanel — test"
    slug: "filter-panel-test"
    type: "test"
    depends-on: []
  - id: "004"
    subject: "Shared FilterPanel + bar refactor — impl"
    slug: "filter-panel-impl"
    type: "impl"
    depends-on: ["003", "002"]
  - id: "005"
    subject: "Funnel pill + popover — test"
    slug: "funnel-pill-test"
    type: "test"
    depends-on: []
  - id: "006"
    subject: "Funnel pill + popover — impl"
    slug: "funnel-pill-impl"
    type: "impl"
    depends-on: ["005", "004"]
  - id: "007"
    subject: "Surface settings model — test"
    slug: "surface-settings-test"
    type: "test"
    depends-on: []
  - id: "008"
    subject: "Surface settings model — impl"
    slug: "surface-settings-impl"
    type: "impl"
    depends-on: ["007"]
  - id: "009"
    subject: "Surface manager mount — test"
    slug: "surface-manager-test"
    type: "test"
    depends-on: []
  - id: "010"
    subject: "Surface manager mount — impl"
    slug: "surface-manager-impl"
    type: "impl"
    depends-on: ["009", "006", "008"]
  - id: "011"
    subject: "Command palette — test"
    slug: "command-palette-test"
    type: "test"
    depends-on: []
  - id: "012"
    subject: "Command palette — impl"
    slug: "command-palette-impl"
    type: "impl"
    depends-on: ["011", "002", "008", "010"]
  - id: "013"
    subject: "Extension popup panel — test"
    slug: "popup-panel-test"
    type: "test"
    depends-on: []
  - id: "014"
    subject: "Extension popup panel — impl"
    slug: "popup-panel-impl"
    type: "impl"
    depends-on: ["013", "004"]
  - id: "015"
    subject: "Options surface + preset management — test"
    slug: "options-surfaces-test"
    type: "test"
    depends-on: []
  - id: "016"
    subject: "Options surface + preset management — impl"
    slug: "options-surfaces-impl"
    type: "impl"
    depends-on: ["015", "008", "002"]
  - id: "017"
    subject: "End-to-end filter surfaces flow"
    slug: "e2e-filter-surfaces"
    type: "test"
    depends-on: ["010", "002"]
  - id: "018"
    subject: "Live-DOM verification on real x.com"
    slug: "live-dom-verification"
    type: "verify"
    depends-on: ["010", "017"]
```

**Task File References (for detailed BDD scenarios):**
- [Task 001: Presets store contract — test](./task-001-presets-store-test.md)
- [Task 002: Presets store contract — impl](./task-002-presets-store-impl.md)
- [Task 003: Shared FilterPanel — test](./task-003-filter-panel-test.md)
- [Task 004: Shared FilterPanel + bar refactor — impl](./task-004-filter-panel-impl.md)
- [Task 005: Funnel pill + popover — test](./task-005-funnel-pill-test.md)
- [Task 006: Funnel pill + popover — impl](./task-006-funnel-pill-impl.md)
- [Task 007: Surface settings model — test](./task-007-surface-settings-test.md)
- [Task 008: Surface settings model — impl](./task-008-surface-settings-impl.md)
- [Task 009: Surface manager mount — test](./task-009-surface-manager-test.md)
- [Task 010: Surface manager mount — impl](./task-010-surface-manager-impl.md)
- [Task 011: Command palette — test](./task-011-command-palette-test.md)
- [Task 012: Command palette — impl](./task-012-command-palette-impl.md)
- [Task 013: Extension popup panel — test](./task-013-popup-panel-test.md)
- [Task 014: Extension popup panel — impl](./task-014-popup-panel-impl.md)
- [Task 015: Options surface + preset management — test](./task-015-options-surfaces-test.md)
- [Task 016: Options surface + preset management — impl](./task-016-options-surfaces-impl.md)
- [Task 017: End-to-end filter surfaces flow](./task-017-e2e-filter-surfaces.md)
- [Task 018: Live-DOM verification on real x.com](./task-018-live-dom-verification.md)

## BDD Coverage

All behaviours from the design spec map to tasks:

| Spec behaviour | Task(s) |
|----------------|---------|
| Named presets: save / apply / rename / delete + persistence | 001, 002 |
| Shared `<FilterPanel>` (chips, legend, master, hidden count, presets row); bar reuses it | 003, 004 |
| Floating funnel pill: badge count, drag + persisted position, open/close, route gating, dim-when-off | 005, 006 |
| Independent per-surface enablement + pill position + palette hotkey in settings | 007, 008 |
| Surface manager mounts each enabled in-page surface; re-evals on route change | 009, 010 |
| Command palette: hotkey overlay, fuzzy match over criteria / presets / actions | 011, 012 |
| Extension popup renders `<FilterPanel>` over the synced store | 013, 014 |
| Options: surface toggles + palette hotkey + preset management UI | 015, 016 |
| End-to-end: pill → set criterion → feed updates → save preset → reload → persists | 017 |
| Sticky bar as a managed, FilterPanel-backed surface (lowest priority) | 004 (refactor), 010 (mount when `surfaces.bar`) |
| Pill ↔ selection ActionBar coexistence (distinct anchor / z-index, no overlap) | 005, 006 |
| Preset rename / delete (Options); popover/panel presets row = apply + save only | 016 (Options); 004 (panel scope) |
| Palette hotkey opens the palette via the manager | 012 |
| Live-DOM verification on real x.com (verify-by-effect) | 018 |

Engine semantics (tri-state, hide-wins, only AND/OR, language gate, reversible stub) are unchanged and remain covered by existing engine tests.

## Dependency Chain

```
(no setup task — engine + bar/options foundation already exist)

001 presets-test ─→ 002 presets-impl ─┬─────────────────────────────┐
                                       │                             │
003 panel-test ─→ 004 panel-impl ◀─────┘                             │
                       │                                             │
005 pill-test ─→ 006 pill-impl ◀───────┘                             │
                       │                                             │
007 settings-test ─→ 008 settings-impl ─┬─→ 010 surface-manager-impl │
                                         │        ▲                  │
009 manager-test ───────────────────────┼────────┘                  │
                                         │                           │
011 palette-test ─→ 012 palette-impl ◀───┴── (002, 008, 010) ◀───────┤
                                                                     │
013 popup-test ─→ 014 popup-impl ◀── (004)                           │
                                                                     │
015 options-test ─→ 016 options-impl ◀── (008, 002) ◀────────────────┘

010 + 002 ─→ 017 e2e-filter-surfaces
010 + 017 ─→ 018 live-dom-verification   (manual verify-by-effect on real x.com)
```

**Analysis**:
- No circular dependencies (every edge points to a strictly lower task id; verified by the dependency-graph reviewer).
- Foundation → presets/panel → surfaces → settings/manager → secondary surfaces → e2e → live verify.
- Parallelism: all `*-test` (Red) tasks are independent and can be written first in parallel. `002`, `008` are leaf impls that unblock most others. `006`, `014`, `016` can proceed in parallel once their prerequisites land; `012` now follows `010` (it extends the manager with the palette hotkey).
- **Shared-file modifications** (one task each within this plan): `filter-types.ts`/`filter-store.ts` (002), `settings.ts` (008), `filter-bar.tsx` (004), `main.tsx` (010), `PopupApp.tsx` (014), `OptionsApp.tsx` (016). `surface-mount.ts` is created by 010 and extended by 012 (dep-sequenced).
- **Coordination points** (rebase onto the committed foundation first): `004` (refactors `filter-bar.tsx`), `010` (edits `main.tsx`), `014` (edits `PopupApp.tsx`), `016` (edits `OptionsApp.tsx`).

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-06-14-filter-surfaces-plan/`. Execution options:**

**1. Orchestrated Execution (Recommended)** — Load `superpowers:executing-plans` skill using the Skill tool.

**2. Direct Agent Team** — Load `superpowers:agent-team-driven-development` skill using the Skill tool.

**3. BDD-Focused Execution** — Load `superpowers:behavior-driven-development` skill using the Skill tool for specific scenarios.
