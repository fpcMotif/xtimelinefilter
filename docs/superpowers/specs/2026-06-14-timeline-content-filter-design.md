# Timeline Content Filter — Design

- **Date:** 2026-06-14
- **Status:** Grilled 2026-06-14; reconciled in a 2nd brainstorming session 2026-06-14 — **deltas:** Language is now a single "only my languages" switch (was per-language chips); user-editable **Link rules** in v1; filter bar is a **sticky bar under the tab strip**. Hide stays deferred (ADR-0010) and v1 scope stays Home + Lists. Pending user review, then writing-plans.
- **Author:** f + Claude
- **Related:** ADR-0003 (UI in Shadow DOM), ADR-0004 (centralized selectors), ADR-0006 (UI activation), ADR-0009 (Mirror posture), ADR-0010 (reversible-stub hide), CONTEXT.md (domain language), MISSION.md (verify-by-effect)

## 1. Intent

Give the user a client-side **Filter** over the x.com timeline: while reading Home (For You / Following) or a List, narrow the feed to the kinds of posts they want and suppress the kinds they don't. Filtering is **read-only and display-only** — it classifies posts already on the page and collapses the ones that don't match. It never calls X, never acts on X's behalf, and is never load-bearing for Lasso's assign/undo flow (mirrors the Mirror invariant, ADR-0009).

Concretely, the user can, in one pass: keep only posts in their languages, hide native video, and surface only arXiv / Hacker News links — the dimensions named in the original request, generalized.

## 2. New domain language (to fold into CONTEXT.md / GLOSSARY.md)

- **Facet** — a classifiable property of a **Tweet**, read purely from its `article` in the page. Facets are **independent predicates**, not one enum: a post can be `photo` *and* `quote` *and* carry a `link` at once. The set is `{hasText, hasPhoto, hasVideo, hasQuote, hasLink}` + `linkDest` (a set of hosts) + `role` (repost) + author flags + `lang`. `text-only` is the derived predicate "has text and none of photo/video/quote/link". DOM-derived, isolated-world-safe, no network. Sibling concept to the author that `tweet-extractor` pulls out.
- **Criterion** — one filterable facet value the user can switch (e.g. `kind:video`, `linkDest:arxiv`).
- **Filter mode** — the per-criterion tri-state: `off | only | hide`.
- **Filter** — the feature as a whole: given a Tweet's Facets and the current modes, it decides `show | hide`.
- **Hidden cell** — a timeline cell (`div[data-testid="cellInnerDiv"]`) the Filter collapses to a thin "· hidden — show" **stub** (a small measurable height, not `display:none`), chosen to stay gentle on X's height-based virtualization (ADR-0010). Never removed from the DOM, always restorable; the Filter only ever toggles this collapsed state. A Hidden cell is **inert for List-assign**: no selection overlay, not click-selectable, skipped by select mode (Q4 of the grill).
- **Family** — a group of related criteria: Media kind, Link destination, Post role, Language.
- **Link rule** — a `host → destination` mapping consulted by `link-classifier`. Built-in defaults (arxiv, hn, reddit, youtube, github) plus **user rules added in Options (v1)**, which win over defaults; any other external host falls back to the generic **Article/Blog** destination.
- **My languages** — the user's allowlist of BCP-47 codes (default seeded from `navigator.languages`). The Language family is a single **"only my languages"** gate: when on, a post whose detected `lang` is outside the allowlist is hidden; a post with no detectable `lang` is shown (fail-open). Per-language *only/hide* chips are deferred to v2.

## 3. Scope

**In scope (v1):**
- **Timelines:** Home (`/home`, both For You and Following tabs), List timelines (`/i/lists/<id>`), and profile timelines (`/<handle>` and its post sub-tabs — promoted from fast-follow 2026-06-20, see Update below). Detected by URL; the Filter UI and applier are inert elsewhere.
- **Facets (the "green-dot core"):**
  - **Media kind:** `text` (no media/card/quote), `photo`, `video`, `quote`, `link` (has an external link card). A media kind is read from the post's *displayed* content and is **independent of `role`**: X renders a repost's original media inline, so a **repost of a video** reads as `video` *and* `repost`. Hence `kind:video=only` surfaces **both** fresh videos and reposted ones (the kind family and the role family are orthogonal — only a `role:repost=hide` would, by hide-wins, drop a reposted video).
  - **Link destination** (sub-facet of `link`, by outbound host): `arxiv`, `hn`, `reddit`, `youtube`, `github`; any other external host → generic **Article/Blog**. The host→destination table is **user-extensible in v1** via Link rules (Options); user rules win over defaults.
  - **Language:** a single **"only my languages"** toggle gated on the user's **My-languages** allowlist (configured in Options; default from `navigator.languages`); each post's language is read from the `lang` attribute on `[data-testid="tweetText"]`. Per-language *only/hide* chips deferred to v2.
  - **Post role:** `repost` (retweet/repost via socialContext).

**Deferred to v2 (amber — heuristic or extra plumbing):**
GIF, poll, reply, thread, pinned; author `verified` / `org`; **"in one of my Lists"** (reuses Lasso's membership knowledge — attractive, but needs the Mirror/REST membership path wired in); blog/news destination heuristics; per-language only/hide chips. Each is listed in §11.

**Out of scope:** Search, notifications, bookmarks timelines; any action against X; server-side or cross-device filter sync.

**Update (2026-06-20): profile timelines promoted from fast-follow to in scope.** Profile pages use the same virtualized `cellInnerDiv` / `article[data-testid="tweet"]` structure as Home/List (research 03 §1), so the applier and facets work unchanged — the route gate (`content/route.ts isInScope`) was the only thing keeping them out. `isInScope` now also matches `/<handle>` and known profile post sub-tabs (`with_replies`, `media`, `likes`, …), guarded by a reserved-route deny-list so X's own nav routes (`/explore`, `/messages`, `/i/*`, …) stay out. Live-DOM confirmation of the visible filter behaviour on a real profile is still pending (same `verify-*-dom.md` discipline as the rest of §3).

## 4. Filter model & semantics

Each criterion has a mode `off | only | hide`. The UI chip cycles `off → only → hide → off` (the tri-state chosen in brainstorming).

For a Tweet `T` with computed `Facets`, given the active criteria:

1. **Hide wins.** If `T` matches **any** criterion in `hide` mode → **hide**.
2. **Language gate.** If "only my languages" is on and `T` has a detectable `lang` outside **My languages** → **hide**. A post with no detectable `lang` passes the gate (fail-open).
3. **Only is a whitelist, AND across families / OR within a family.** Let `F` be the set of families that contain at least one `only` criterion. If `F` is empty → **show** (subject to steps 1–2). Otherwise `T` shows only if, for **every** family in `F`, `T` matches **at least one** of that family's `only` criteria.
4. Otherwise → **show**.

**Worked examples:**

| Active modes (My languages = {ja}) | A Japanese arXiv-link post | A Japanese native-video post | An English text post |
|---|---|---|---|
| only-my-languages ON | show | show | hide (en ∉ {ja}) |
| only-my-languages ON, `kind:video=hide` | show | **hide** (hide wins) | hide |
| `linkDest:arxiv=only`, `linkDest:hn=only` | show | hide | hide |
| only-my-languages ON, `linkDest:arxiv=only` | show (ja **and** arxiv) | hide (not arxiv) | hide |

**Fail-open:** if facet extraction throws or returns nothing usable for `T`, `T` is treated as **show**. The Filter never hides a post it could not classify.

## 5. Architecture

New units, each single-purpose, matching the existing `core/*` (pure) + `content/*` (DOM-wiring) split.

```
core/tweet-facets.ts     extractFacets(article) -> Facets         PURE, isolated-world-safe (sibling of tweet-extractor)
core/link-classifier.ts  classifyHost(url, rules) -> LinkDest     PURE, default table + user Link rules
core/timeline-filter.ts  decide(facets, state) -> "show"|"hide"   PURE, the §4 semantics engine
core/filter-store.ts     reactive FilterState + master enable     signals + storage.sync (sibling of settings/selection-store)
content/filter-applier.ts  stub/restore cells; scanner hook        DOM side-effects only, route-aware
ui/filter-bar.tsx        tri-state chip bar, hidden count         Preact in the existing Shadow DOM
content/selectors.ts     + FacetSelectors                         the one place to fix on an X redesign (ADR-0004)
```

- **`core/tweet-facets.ts`** — `extractFacets(article: Element): Facets`. Reads kind (presence of `tweetPhoto` / `videoPlayer|videoComponent` / `card.wrapper` / nested quoted article / bare `tweetText`), outbound link hosts (from card + status-body anchors), `role` (socialContext → repost), and `lang` (the `lang` attribute on `[data-testid="tweetText"]`). Pure, returns a plain object, unit-tested with DOM fixtures. **Wraps every read in try/catch → partial Facets, never throws (fail-open).**
- **`core/link-classifier.ts`** — `classifyHost(href, userRules): LinkDest`. A default host table (`arxiv.org`→arxiv, `news.ycombinator.com`→hn, `reddit.com`→reddit, `youtube.com`/`youtu.be`→youtube, `github.com`→github) with any other external host → generic **Article/Blog**. **User Link rules (from Options) are merged ahead of the defaults** (v1). Pure, table-driven, trivially testable; categories are data, so more are additive.
- **`core/timeline-filter.ts`** — `decide(facets, state): "show" | "hide"`. Implements §4. No DOM, no I/O. Truth-table tested.
- **`core/filter-store.ts`** — reactive `FilterState` = `Record<CriterionId, FilterMode>` + `onlyMyLanguages` flag + `myLanguages: string[]` + user `linkRules` + `enabled` master signal. Persisted to `storage.sync` (single global filter in v1; per-timeline profiles deferred); `myLanguages` defaults from `navigator.languages`. Mirrors the `createSettings` pattern.
- **`content/filter-applier.ts`** — subscribes to `filter-store`; for each in-scope cell, calls `decide` and collapses non-matching `cellInnerDiv`s to the reversible stub (ADR-0010). Hooks the **existing** `createTweetScanner` callback (so newly streamed-in posts are classified as they arrive) and re-runs over visible cells whenever `FilterState` changes. **Re-classifies on every scan — never caches a verdict on a node** (X recycles cells; a stale verdict would mis-hide a recycled Tweet). Tracks the hidden count. Idempotent; on disable/`off`/"show", restores. Inert when the URL is out of scope; re-evaluates on SPA route change.
- **`ui/filter-bar.tsx`** — the tri-state chip bar, grouped by Family, bound to `filter-store`; shows "N hidden — show anyway", the **"only my languages"** toggle, and the master toggle. Rendered as a **sticky bar docked under the For You/Following tab strip** in the existing open Shadow DOM tree (ADR-0003); only mounted on in-scope timelines.
- **Options page** (`src/options`) — two new editors: the **My-languages** allowlist (BCP-47 chips) and the **Link rules** table (host pattern → destination), persisted via `filter-store`/`settings`.

### Integration with existing wiring (`content/main.tsx`)
`createTweetScanner(document, cb, opts)` already walks every tweet article and fires `cb(author, article)` for overlay injection. We extend the wiring so the same scan also feeds `filter-applier.classify(article)`. The applier must coexist with overlay injection and select-mode click handling — it only toggles the cell's collapsed-stub state, touching nothing Lasso already owns, and a stubbed cell is inert for List-assign (no overlay, not selectable). The Filter shares Lasso's activation lifecycle — it lives inside `start()` and is asleep when Lasso is dormant (ADR-0006). The filter bar mounts alongside the existing `App` in the shadow root.

## 6. Data flow

```
MutationObserver (existing scanner)
   └─> filter-applier.classify(article)
          ├─ core/tweet-facets.extractFacets(article)  (uses core/link-classifier + user rules)
          ├─ core/timeline-filter.decide(facets, filterStore.state)   (re-decided every scan, never cached)
          └─ collapse the cell to a stub (or restore) + update hidden count
filter-bar  --(user cycles a chip / toggles "only my languages")-->  filter-store.set(...)
   └─> persists to storage.sync  +  filter-applier re-applies to all visible cells
master toggle off  ->  filter-applier.restoreAll()  (native feed returns instantly)
```

## 7. Reliability & invariants (MISSION.md / verify-by-effect)

- **Display-only, never acts on X.** The Filter reads the DOM and toggles a cell's collapsed-stub state (ADR-0010). There is no click against X, so the caret-action "acceptance signal" problem does not arise — but selector **correctness**, and the stub's effect on X's virtualization, still must be verified against live X, not assumed.
- **Live-DOM verification gate.** Before any facet ships, its selector is verified on live x.com and recorded in a `verify-*-dom.md` note (matching the existing `verify-tweet-author-dom.md` discipline). Green-dot facets in §3 are backed by selectors already in `selectors.ts` or strong known behavior (the `lang` attribute); they still get a confirmation pass. No fantasy fixtures (lessons/0002, the verify-by-effect memory).
- **Breakage health.** Reuse the `scanner-health` idea: if, over a window, facet extraction yields an implausible distribution (e.g. ~100% classified `text` because the media selectors broke), raise a breakage signal rather than silently mis-hiding the whole feed. A broken classifier must fail toward **showing** posts.
- **Never load-bearing.** A Filter failure never blocks or alters Lasso's assign/undo/toasts/select-mode. If `filter-store` or the applier dies, the page and Lasso behave exactly as before.
- **No `innerHTML` of page data** (ADR-0003) — the filter bar is a Preact tree; facet reads are attribute/`textContent` only.

## 8. Error handling

- `extractFacets` and `classifyHost` are total: any thrown read degrades to partial Facets → fail-open (show).
- `filter-applier` guards every DOM write; a throw on one cell never aborts the batch.
- `storage.sync` read/write failures fall back to in-memory defaults (Filter disabled), never throw into the page.
- Master toggle and "show anyway" always restore, even if state is corrupt.

## 9. UI

- A compact, **sticky chip bar docked under the For You/Following tab strip** in the existing Shadow-DOM UI, grouped by Family. Each chip is tri-state with a clear visual for off/only/hide (e.g. neutral / green-ring "only" / red-strike "hide"). The Language group is the single **"only my languages"** toggle.
- **Starts as a no-op:** active but with zero criteria set, so it shows everything until the user picks a chip. The master toggle exists mainly to instantly clear all filtering.
- A live "**N hidden**" line with **show anyway** (temporarily disables the Filter for the current view) and a **master on/off**. Each Hidden cell's stub is itself a one-click inline un-hide for that single post.
- Visible only on in-scope routes (`/home`, `/i/lists/*`); **re-evaluates on SPA route change**; respects `highContrast` like the rest of the UI.
- Honors the existing activation model (ADR-0006): on on-demand tabs the Filter is inert until Lasso is woken.
- **Options page**: edit the My-languages allowlist and custom Link rules; the in-feed bar reflects them live.

## 10. Testing strategy

- **Pure unit tests** (the bulk): `extractFacets` against DOM fixtures for each kind/role/lang; `classifyHost` host table + user-rule override; `decide` truth tables for §4 (hide-wins, language-gate, AND-across-families/OR-within, empty-only, fail-open).
- **filter-store**: persistence round-trip (incl. `myLanguages` + `linkRules`), master toggle, default state.
- **filter-applier**: hide/restore idempotency, fail-open, coexistence with overlay injection, re-apply on state change, restore-all on disable.
- **e2e** (`e2e/content.spec.ts` already exists): load a fixture timeline, cycle a chip, assert non-matching `cellInnerDiv`s collapse to the stub and matching ones stay; click a stub's "show" → that one restores; toggle master off → all restored.
- **Live-DOM notes**: one verification note per facet selector before it ships.

## 11. Resolved in grill (2026-06-14)

- **Tweet is a first-class subject for the Filter capability** (Q1) — CONTEXT.md updated; the "never saves a tweet" line now scopes to List-assign.
- **Hide mechanic = reversible collapse-to-stub**, not `display:none` (Q2) — ADR-0010. Full `display:none` is a future upgrade behind a live-virtualization verification note. *(Reaffirmed in session 2.)*
- **Only-semantics = AND-across-families / OR-within-family** (Q3) — see §4 truth table. *(Reaffirmed in session 2.)*
- **Hidden cell is inert for List-assign** (Q4) — no overlay, not selectable.
- **Filter rides Lasso's activation lifecycle, starts as a no-op, route-reactive** (Q5).
- **Persistence = one global filter in `storage.sync`, synced** (Q6); per-timeline profiles deferred.

### Reconciled in session 2 (2026-06-14)
- **Language = single "only my languages" switch** over a user allowlist (was per-language `lang:ja`/en/zh/ko chips). Simpler model the user chose; per-language only/hide chips become a v2 facet.
- **User-editable Link rules in v1** — `link-classifier` takes user `host→destination` rules (Options) merged ahead of defaults; generic external host surfaces as Article/Blog.
- **Filter bar placement = sticky bar under the For You/Following tab strip** (was unspecified).
- **Unchanged from the grill:** Hide stays deferred (stub only); v1 scope stays Home + Lists.

### Deferred to v2
- **v2 facets:** GIF, poll, reply, thread, pinned, verified, org, blog/news destination heuristics, per-language only/hide chips — each needs live-DOM verification.
- **"In one of my Lists" facet:** high-value tie-in to Lasso's core, but depends on membership data (Mirror/REST). Its own slice once v1 lands.
- **Per-timeline filter profiles** (independent saved filters for Home vs each List).
- **Global AND/OR toggle** as an escape hatch from the §4 default.
- **Full `display:none`** once the virtualization verification note clears it.
- **Search timelines** — fast-follow once their cell/article structure is verified live. (Profile timelines shipped 2026-06-20 — see §3 Update.)

## 12. Verifiable goals (hand to writing-plans / tdd)

```
1. core/link-classifier.classifyHost(url,rules) -> verify: unit table maps arxiv/hn/reddit/youtube/github → category, else Article/Blog; user Link rules override defaults
2. core/tweet-facets.extractFacets(article) -> verify: DOM-fixture tests yield correct {hasText,hasPhoto,hasVideo,hasQuote,hasLink}, linkDest set, role, lang; a thrown read degrades to partial Facets (fail-open), never throws
3. core/timeline-filter.decide(facets,state)-> verify: truth tables — hide-wins, language-gate (only-my-languages hides lang∉set, undetectable=show), AND-across-families/OR-within-family, empty-only=show, unclassified=show
4. core/filter-store                         -> verify: tri-state cycle off→only→hide→off; onlyMyLanguages + myLanguages + user linkRules persisted; storage.sync round-trip; master toggle; default no-op
5. content/filter-applier                    -> verify: collapses non-matching cell to reversible stub; "show" restores one; re-classifies every scan (no cached verdict); restore-all on disable; fail-open on throw; stubbed cell gets no overlay + skipped by select mode; inert off-route; re-evaluates on SPA route change
6. ui/filter-bar + options                   -> verify: tri-state chips grouped by family + "only my languages" toggle + "N hidden / show anyway" + master toggle; sticky under tab strip; mounts only on /home and /i/lists/*; Options edits My-languages + Link rules
7. Live-DOM verification (MISSION.md)        -> verify: a verify-*-dom.md note confirms each green facet selector AND that the stub does not trigger over-fetch/scroll-jump on real x.com, BEFORE trusting it
8. Invariant                                 -> verify: Filter never calls X, never blocks/alters assign/undo/select; disabling it leaves Lasso byte-for-byte unchanged
```
