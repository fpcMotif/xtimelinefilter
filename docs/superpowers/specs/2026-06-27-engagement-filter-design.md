# Engagement filter — hide posts you've already liked / bookmarked

**Status:** Design — pending live-DOM verification gate (§9)
**Date:** 2026-06-27
**Branch:** `claude/convex-mirror`
**Builds on:** timeline-content-filter (DOM hide/show core), filter-surfaces (criteria-matrix UI),
filter conductor + one-Z undo (controller.ts).

## 1. Problem

When scrolling Home / a List / a profile timeline, the user keeps seeing posts they've **already
engaged with** — already liked, already bookmarked. Their intent: *"I've already saved/seen this,
don't show it to me again — not at all, even the moment I like it."*

## 2. Goal & non-goals

**Goal:** two new filter criteria, **Liked** and **Bookmarked**, that plug into the existing
tri-state cycle (`off → only → hide → off`). Set to **hide**, a post the user has liked/bookmarked
collapses out of the timeline — on mount *and* the instant the user toggles like/bookmark live.

**Free bonus (same criteria, no extra work):** set to **only** → review just your liked / bookmarked
posts within the currently-loaded feed.

**Non-goals (YAGNI):**
- **No storage / Convex.** X already persists like/bookmark state and re-renders it on every load;
  the rendered DOM *is* the source of truth. We read it; we do not mirror it. (Convex/local storage
  remains a documented fallback only if §9 verification proves the DOM signal unreliable.)
- **No injection of full bookmark/like history.** This is a DOM hide/show filter; it only acts on
  posts already rendered in the feed. It does not fetch your Bookmarks page or Likes tab. A post
  liked last week appears only if the algorithm surfaces it.
- **No new UI surface.** The criteria-matrix, popup, palette, store, and presets are data-driven and
  pick the new criteria up for free (verified — §6).

## 3. Behavior

| Criterion | `hide` mode (the ask) | `only` mode (bonus) | `off` |
|-----------|-----------------------|---------------------|-------|
| **Liked** | collapse posts you've liked — on mount and on live like | show only liked posts | ignored |
| **Bookmarked** | collapse posts you've bookmarked — on mount and on live bookmark | show only bookmarked | ignored |

New criteria group **"Engagement"**, rendered after Type / Links / Source.

**Intended recipe (state in UX copy):** "hide everything I've already engaged with" = set **both**
`hide:liked` and `hide:bookmarked`. There is no single combined toggle; this matches the existing
OR-within-family / AND-across-family model (no special-casing). (Hole H4.)

## 4. Mechanism — read live DOM, no storage

The action-bar `data-testid` **flips with state**, which is the signal:

- liked → `[data-testid="unlike"]` present (vs `"like"` when not liked)
- bookmarked → `[data-testid="removeBookmark"]` present (vs `"bookmark"`)

These become two booleans on `Facets` (`liked`, `bookmarked`), read in `tweet-read/facets.ts`
exactly like photo/video — but **host-scoped** (§5, B1) and fail-open. `decide()` /
`matchesCriterion` then treat `engagement` like any other family.

**This signal is AMBER** (an assumption) until proven on live x.com per the repo's verify-by-
ground-truth discipline (`docs/research/verify-filter-dom.md`). The testid-flip invariant is well-
attested in production tools (twittervim/xkey), but the *mutation mechanism* and *per-post-type
presence* are not — see §9.

## 5. Resolved blockers

**B1 — Quote-bleed.** `facets.ts` reads via unscoped `article.querySelector`; a quoted tweet nests
its own `article[data-testid="tweet"]` *with its own action bar*. If the quoted post is liked and
the host isn't, an unscoped read marks the host liked. Engagement is the one facet where the quoted
post's state actively lies about the host. **Fix:** add a host-scoped reader used **only** for the
two new facets (leave existing `has` reads untouched — kind/photo/quote encode quote semantics on
purpose):

```ts
const scopedHas = (sel: string): boolean =>
  safe(() => {
    const el = article.querySelector(sel);
    return !!el && el.closest(Selectors.TWEET) === article;
  }, false);
```

This is the same `closest(TWEET) === host` oracle the verify probe already uses.

**B2 — Observer must fire on a live toggle.** The existing lazy-video `hydrationObserver`
(`filter-applier.ts`) watches `{ childList: true, subtree: true }`. If X toggles like by **swapping
`data-testid` on the same button node** (an attribute mutation), childList never fires and the post
won't collapse live. **Fix (ship-safe regardless of how X does it):** extend the *same* observer to
`{ childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid'] }` and reclassify
the enclosing article on both forms (attribute flip *and* node insertion). Watching attributes is a
strict superset, so the feature is correct whether X swaps the attribute or replaces the node. One
observer, not two — reuse its `touched` set + `classify` loop; `dispose()` already disconnects it.

**B3 — Live reclassify must NOT route through the conductor (undo poisoning).** The conductor arms a
10s last-wins undo whenever `filter.state` changes (`controller.ts`). A reclassify driven by X's own
like-action is **not** a user filter command. The observer already calls `applier.classify(article)`
directly (never `store.*`, never the conductor), so extending it inherits correct behavior:
- cycling a chip = a user config change → undoable ✓
- X liking a post → silent reclassify, not undoable ✓

**Net: zero controller/undo edits.** The only risk is an implementer wrongly routing the observer
through `filterCommand` — explicitly forbidden here.

## 6. Architecture — files touched

All edits are small and mostly the catalog. Store / UI / conductor / undo: **untouched** (verified
data-driven: `cycle`/`setMode`/`savePreset`/`applyPreset` are family-agnostic; `CriteriaMatrix`,
the palette builder, and the active-criteria count all iterate `CRITERIA`/`CRITERIA_GROUPS`).

| # | File | Change |
|---|------|--------|
| 1 | `src/core/filter-types.ts` | `Family` union += `"engagement"`; `Facets` += `liked: boolean; bookmarked: boolean` |
| 2 | `src/content/selectors.ts` | `FacetSelectors` += `LIKED: '[data-testid="unlike"]'`, `BOOKMARKED: '[data-testid="removeBookmark"]'` (AMBER) |
| 3 | `src/core/tweet-read/facets.ts` | add `scopedHas`; read `liked`/`bookmarked` into the returned Facets |
| 4 | `src/core/filter-criteria.ts` | append 2 `CriterionDef`: `engagement:liked` ("Liked"), `engagement:bookmarked` ("Bookmarked"), group `"Engagement"` |
| 5 | `src/core/timeline-filter.ts` | `matchesCriterion`: `case "engagement": return (value === "liked" && f.liked) \|\| (value === "bookmarked" && f.bookmarked)` |
| 6 | `src/content/filter-applier.ts` | extend the existing `hydrationObserver` (attributes + node-insertion of unlike/removeBookmark) — single source of truth via `FacetSelectors.LIKED/BOOKMARKED` |
| 7 | tests + verify probe | §8, §9 |

**Naming decisions** (match existing convention exactly): `family: "engagement"` / `group:
"Engagement"`; `short` capitalized (`"Liked"`/`"Bookmarked"`) like `role:repost`'s `"Repost"` — the
lowercase-`short` style is unique to `kind`'s machine values. Catalog placement: appended last, so
`CRITERIA_GROUPS` (first-seen order) renders Engagement after Source.

**Single source of truth (H1):** the engagement testids live in `FacetSelectors`. Both consumers —
`facets.ts` (static read) and `filter-applier.ts` (observer) — reference the same constants
(ADR-0004: one place per hook). The selectors are not "runtime-only signals"; they are facet hooks
with two readers.

## 7. Known interactions to document (not blockers)

- **H2 — SHOW-override vs live toggle.** The per-post "show anyway" stub override is keyed to tweet
  identity, not engagement state. So: hide a liked post → click "show" → un-like → re-like will honor
  the stale show-override and **not** re-collapse. Acceptable (explicit user un-hide wins); documented,
  left as-is.
- **H3 — compact mode live-collapse scroll jump.** The live toggle is the first path that collapses a
  post the user is *actively looking at* (mid-viewport). Under `compactHidden: true` (0-height, ADR-0010,
  opt-in, default off) this shifts scroll under the cursor. Acceptable for v1 (default is stub mode);
  verify it doesn't fight X's virtualization during §9.

## 8. Test plan — hold 100% coverage

**`tests/core/tweet-read/facets.test.ts`** (reuse the `article(innerHTML)` fixture):
- `unlike` present → `liked:true`; absent → `false`. Same for `removeBookmark`/`bookmarked`.
- one present / one absent (decouples the booleans).
- **Quote-bleed regression (B1):** nested quoted `article` carrying `unlike`, host's own bar carrying
  `like` → host `liked:false`. This is the test that proves `scopedHas` over `has`.
- fail-open: throw/missing bar → both `false`, no throw (covers the `safe` catch branch).

**`tests/core/timeline-filter.test.ts`** (add `liked:false, bookmarked:false` to `BASE_FACETS` —
**H5: load-bearing**, the shared fixture must gain these or the suite won't typecheck):
- `matchesCriterion` liked/bookmarked true/false pairs.
- unknown engagement value → false (covers the `&&` false arms).
- `hide:liked` collapses liked / shows unliked; same bookmarked.
- `only:liked` shows liked / hides unliked.
- OR-within-family: `only:liked + only:bookmarked`, liked-only post → show.
- AND-across-families: `only:engagement:liked + only:linkDest:arxiv` → liked-no-arxiv ⇒ hide;
  liked+arxiv ⇒ show.

**`tests/content/filter-applier.test.ts`** (mirror the video-hydration block, reuse `addCell`):
- `hide:liked`: inject `unlike` via childList → collapses; revert → uncollapses. Same bookmarked.
- **attribute-swap path:** start with `like`, change its `data-testid` to `unlike` in place →
  observer (attributes branch) collapses. (The branch the old config would have missed — proves B2.)
- mutation with no ancestor article → no reclassify, no throw (covers the `closest` null branch).
- `dispose()` disconnects.

**`tests/ui/criteria-matrix.test.tsx`:**
- "Engagement" heading + "Liked"/"Bookmarked" chips render; cycling each progresses off→only→hide→off
  and updates the store.

## 9. Live-DOM verification gate (AMBER → confirmed)

Extend `scripts/verify-facet-selectors.console.js` and run on a logged-in x.com before merge. Unit
tests prove extraction *logic* only; they cannot prove the selectors match real buttons. The probe
must additionally prove:

1. `unlike` / `removeBookmark` actually appear on liked/bookmarked posts.
2. **U1 (highest risk):** the mutation mechanism — attribute swap vs node replace — log `m.type` on a
   manual like-click. Drives whether the attribute-watch in B2 is exercised; the fix is correct either
   way, but this right-sizes the test and confirms cost.
3. action bars render on Home, `/i/lists/*`, profile (incl. pinned), thread/conversation, promoted.
4. eyeball oracle: print `{id, liked, bookmarked, visible button label}` per sampled post (no DOM-
   independent oracle exists for engagement).

**Other unknowns to record while inspecting:** U2 — is the mutation synchronous with the click (race
window where `classify` reads stale facets)? Likely a non-issue since the observer fires *on* the
mutation, but verify. U3 — which post types lack an action bar (fail-open shows them; document the
inert paths). U4 — exact aria-label/aria-pressed text, for a possible future locale-proof oracle.

Until this gate is green, `FacetSelectors.LIKED/BOOKMARKED` stay AMBER and engagement classification
is unproven on live x.com.

## 10. Rollout

1. Implement edits 1–6 + tests (§8) → green local CI gate (lint + format:check + 100% coverage).
2. Build, load the extension, run the §9 probe on live x.com; record results in
   `docs/research/verify-filter-dom.md`.
3. If U1 shows attribute-swap, confirm the live-collapse works end-to-end (B2); if a post type lacks
   an action bar, confirm fail-open shows it (U3).
4. Promote selectors AMBER → verified.
