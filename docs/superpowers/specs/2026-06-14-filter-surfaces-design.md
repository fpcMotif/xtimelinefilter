# Filter Surfaces — Design

- **Status:** Draft (pending user review)
- **Date:** 2026-06-14
- **Builds on:** [`2026-06-14-timeline-content-filter-design.md`](./2026-06-14-timeline-content-filter-design.md) (the filter engine + semantics)
- **Supersedes:** the "sticky chip bar is the only UI" assumption of that spec (task-013). The bar is retained but demoted to the lowest-priority surface.
- **Relevant ADRs:** ADR-0003 (no `innerHTML`), ADR-0004 (central selector registry), ADR-0010 (filter hides cells via a reversible stub)

## 1. Summary

The timeline content filter engine is fully built (`tweet-facets` → `timeline-filter.decide()` → `filter-applier`, driven by the reactive `filter-store`), but it has **no user-facing UI yet**. The only planned surface was a sticky chip bar pinned under the For You / Following tab strip.

This spec replaces that single-surface plan with a **configurable, multi-surface UI** designed to make filtering *flexible, convenient, and fluid*:

- A **floating funnel pill** that opens a rich popover is the **default** surface.
- A **command palette**, an **extension popup**, and the original **sticky bar** are alternative surfaces the user can switch to in Settings.
- Every surface is a thin view over the same `filter-store`, so they stay in sync for free and the engine is untouched.
- **Named presets** ("Reading", "Media only", "No reposts") let one global filter be reshaped instantly, and feed the command palette.

## 2. Goals / Non-goals

**Goals**

- Give the filter a discoverable, low-friction in-page control that does not consume permanent feed space.
- Express the engine's per-criterion tri-state (`off` / `only` / `hide`) in a compact, fast way.
- Let the user save and re-apply named filter configurations (presets).
- Let the user choose which surface they prefer, defaulting to the funnel pill.
- Reuse the existing engine, store, selectors, Shadow DOM mount, and theme without modification to the decision logic.

**Non-goals (deferred to v2)**

- **Per-timeline profiles** (a distinct auto-switching filter for Home vs each List). The chosen model is one global filter + presets.
- **Per-language `only`/`hide` chips.** v1 keeps the single "only my languages" gate.
- New facets beyond those already extracted (GIF, poll, reply, thread, verified badge, etc.).
- Search / profile timeline scope. v1 stays Home + Lists.

## 3. Architecture: one engine, many views

```
              ┌──────────────────── filter-store (signal, chrome.storage.sync) ───────────────────┐
              │   enabled · criteria (tri-state) · onlyMyLanguages · myLanguages · linkRules · presets │
              └───────▲──────────────────▲────────────────────▲───────────────────────▲─────────────┘
                      │                  │                    │                       │
                FunnelPill+Popover   CommandPalette       ExtensionPopup           StickyBar
                  (default)            (hotkey)            (toolbar)             (lowest priority)
                      │                  │                    │                       │
                      └──────────── all host the SAME <FilterPanel> body ─────────────┘

   filter-store.state ──(effect)──▶ filter-applier.reapplyAll() ──▶ reversible hidden stubs (ADR-0010)
```

- The **engine is unchanged**: `tweet-facets.extractFacets()`, `timeline-filter.decide()`, `filter-applier`, `selectors`.
- Each surface mounts in the existing **open Shadow DOM** (`src/ui/mount.tsx`) and shares the existing OKLCH theme + `data-hc` high-contrast support.
- A small **surface manager** (in `src/content/main.tsx`) reads the surface preferences and mounts each enabled in-page surface; it re-evaluates on SPA route change exactly like the existing UI mount, and only on in-scope routes (`/home`, `/i/lists/*`).

## 4. Shared component: `<FilterPanel>`

**File:** `src/ui/filter-panel.tsx`. The single source of the filter body, hosted by every surface.

Composition:

- **Cycle chips grouped by family:**
  - **Media** — `text`, `photo`, `video`, `quote`, `link`
  - **Links** — `arxiv`, `hn`, `reddit`, `youtube`, `github`, `article`
  - **Other** — `repost`, and a `🌐 only my languages` chip
- Tapping a chip calls `store.cycle(id)` to advance `off → only → hide → off`. Visual state: neutral = off, blue ring = `only`, red strike-through = `hide`.
- **Legend:** `◯ off · ◉ only · ⊘ hide`.
- **Master toggle** → `store.setEnabled()`. When off, the panel reads as inert and the pill badge clears.
- **Hidden count + "show all":** `N posts hidden · show all`; "show all" triggers the applier's temporary override (does not mutate stored criteria).
- **Presets row** (see §6).

Constraints: Preact tree only, no `innerHTML` (ADR-0003); all interaction goes through the `filter-store` API; respects `data-hc`.

## 5. Default surface: floating funnel pill + popover

**File:** `src/ui/funnel-pill.tsx`.

- A **draggable funnel pill** rendered in the Shadow DOM, with a **badge** showing the count of active criteria (non-`off`) plus the language gate.
- **Position** is persisted (`pillPosition`) and **clamped to the viewport**, with a default offset chosen to avoid X's bottom-right compose and DM docks.
- **Coexistence:** the existing `ActionBar` (people-selection UI) appears only during selection; the pill occupies a different anchor and a defined z-index so the two never overlap.
- **Open/close:** click toggles the popover, which anchors to the pill and auto-flips to stay on screen; closes on click-outside or `Esc`; transitions use the theme `--ease-out`.
- **State:** when master is off the pill dims and the badge hides.
- **Mounting:** in-scope routes only; re-evaluated on SPA route change.

## 6. Presets

A preset is a named snapshot of the active filter *selection*.

- **Scope of a preset:** `criteria` + `onlyMyLanguages` (+ optional `myLanguages`). **`linkRules` are NOT part of a preset** — they are global host→destination configuration, not a selection.
- **Storage:** `presets: FilterPreset[]` lives in the filter domain and persists to `chrome.storage.sync` (presets are small; well within sync quotas).
- **Store API additions:** `savePreset(name)`, `applyPreset(id)`, `renamePreset(id, name)`, `deletePreset(id)`.
- **Flows:**
  - **+ save** snapshots the current chips into a named preset.
  - Clicking a preset pill applies it (replaces active `criteria` + language gate).
  - Rename / delete from the Options page (the popover/panel presets row stays compact: apply + save only).
- Presets are first-class searchable entries in the command palette.

## 7. Secondary surfaces + the surface setting

- **Command palette** — `src/ui/filter-palette.tsx`. A configurable hotkey opens a centered Shadow-DOM overlay. Fuzzy search over: criteria (e.g. "video", "hide reposts"), presets (e.g. "Reading"), and actions ("show all hidden", "disable filter"). `Enter` applies; the overlay stays open for rapid multi-toggle; `Esc` closes.
- **Extension popup** — extend `src/popup/PopupApp.tsx` to render `<FilterPanel>` for quick toggling from the toolbar (works even when not focused on the X tab via the synced store). This surface is **always available** via the toolbar — it is not part of the in-page enable/disable set below. Deep config (link rules, languages) links to Options.
- **Sticky bar** (lowest priority) — `src/ui/filter-bar.tsx`, a horizontal condensed `<FilterPanel>` docked under the tab strip for users who want it always on.
- **Surface settings** — the three **in-page** surfaces are **independently enabled**, not mutually exclusive (this is the "switch in settings" the user asked for). Out of the box: funnel **pill on**, command **palette off**, sticky **bar off**. The user enables/disables each in Options and sets the palette hotkey. The extension popup is always present via the toolbar regardless. These controls sit alongside the already-planned my-languages and link-rules editors (task-015).

## 8. Data model changes

**Filter domain** (`src/core/filter-types.ts`, `src/core/filter-store.ts`):

```ts
export interface FilterPreset {
  id: string;
  name: string;
  criteria: Record<CriterionId, FilterMode>;
  onlyMyLanguages: boolean;
  myLanguages?: string[];
}

export interface FilterState {
  enabled: boolean;
  criteria: Record<CriterionId, FilterMode>;
  onlyMyLanguages: boolean;
  myLanguages: string[];
  linkRules: LinkRule[];
  presets: FilterPreset[]; // NEW
}
```

New store methods: `savePreset(name)`, `applyPreset(id)`, `renamePreset(id, name)`, `deletePreset(id)`. Default `presets: []`. Existing persisted state migrates by defaulting a missing `presets` to `[]`.

**Settings / UI domain** (existing options/settings store):

```ts
surfaces: {
  pill: boolean;    // floating funnel pill — default true
  palette: boolean; // command-palette hotkey overlay — default false
  bar: boolean;     // sticky bar — default false (Phase 3)
};
pillPosition: { x: number; y: number }; // persisted, viewport-clamped
paletteHotkey: string;                   // default e.g. "mod+shift+f"
```

The three in-page surfaces are independent toggles (not a single enum). The extension popup is not listed here — it is always available via the toolbar.

**Unchanged:** `tweet-facets`, `timeline-filter.decide()`, `filter-applier`, `selectors`, `link-classifier`, and the tri-state / hide-wins / only-semantics / language-gate logic defined in the engine spec.

## 9. Filter semantics (recap — defined in the engine spec)

No change. Hide-wins; `only` is AND across families and OR within a family; the language gate hides posts whose detected language ∉ `myLanguages` when `onlyMyLanguages` is on, and fails open when language is undetectable. Hidden posts collapse to a reversible `· hidden — show` stub (ADR-0010); "show all" is a temporary, non-persisted override.

## 10. Accessibility, theming, coexistence

- All surfaces use the shared OKLCH theme and honor the `data-hc` high-contrast attribute.
- Chips, the pill, and palette entries are keyboard-operable; the palette is keyboard-first. The popover and palette trap focus while open and restore it on close; `Esc` closes.
- The pill and the existing `ActionBar` use distinct anchors and z-indices and must not overlap.
- No `innerHTML`; facet reads remain attribute/`textContent` only.

## 11. Testing strategy

- **`FilterPanel`:** chip tap → `store.cycle`; preset save/apply; master toggle; hidden-count rendering.
- **`FunnelPill`:** badge count, drag + position persistence + viewport clamping, open/close, route gating, dim-when-disabled.
- **`FilterPalette`:** fuzzy query → correct store action; preset and action matches; multi-toggle stays open.
- **Preset store:** save / apply / rename / delete + `storage.sync` round-trip + migration of state lacking `presets`.
- **E2E:** open pill → set `video = only` → feed updates → save preset → reload → preset persists and re-applies.
- **Regression:** existing engine tests (`tweet-facets`, `timeline-filter`, `link-classifier`, `filter-store`) stay green — no engine changes.
- **Live DOM verification** of the pill mount on real x.com routes (per the engine spec's task-018 discipline).

## 12. Phasing (YAGNI-ordered)

1. **Phase 1 (usable default):** `<FilterPanel>` + `FunnelPill`/popover + presets + the surface-manager scaffold (only `pill` available initially).
2. **Phase 2:** command palette + extension popup + the surface-enablement settings (independent pill / palette toggles + palette hotkey).
3. **Phase 3 (lowest priority):** sticky bar.

## 13. Open questions / future (v2)

- Per-timeline profiles (auto-switching filter per Home / List).
- Per-language `only`/`hide` chips.
- Additional facets (GIF, poll, reply, thread, verified/org badge, blog/news destination heuristics).
- Whether presets should optionally capture `linkRules`.

## 14. Relationship to existing tasks

- **task-013** (filter bar) is reframed: the bar becomes the Phase-3, lowest-priority surface; `<FilterPanel>` + `FunnelPill` become the Phase-1 deliverable.
- **task-015** (Options: my-languages + link-rules editors) gains the surface-preference controls and preset management.
- **task-016** (wire into `main.tsx`) gains the surface manager that mounts the chosen surface.
