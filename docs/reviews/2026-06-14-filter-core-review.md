# Review — Timeline Content Filter, pure core + plan

- **Date:** 2026-06-14
- **Scope reviewed (read-only):** committed pure core `042fbd2` (`core/link-classifier`, `core/timeline-filter`, `core/filter-store`, `core/filter-types`, `content/selectors` FacetSelectors + their tests) and the plan `docs/plans/2026-06-14-timeline-content-filter-plan/`, against the spec `docs/superpowers/specs/2026-06-14-timeline-content-filter-design.md` and `lessons/MISSION.md`.
- **Method:** 5 parallel dimension reviewers + a test run + adversarial verification of every blocker/major finding (skeptic pass, default-to-refute). **No files were modified** by this review.
- **For:** whoever owns the filter implementation on `claude/convex-mirror`. Pick up what's useful; nothing here is blocking.

## Verdict

The pure core is **solid and spec-faithful.** Tests are green and the MISSION verify-by-effect discipline is upheld.

- **Test run:** `bunx vitest run tests/core/link-classifier.test.ts tests/core/timeline-filter.test.ts tests/core/filter-store.test.ts` → **23/23 pass** (link-classifier 6, filter-store 4, timeline-filter 13; vitest 4.1.8, happy-dom, ~221ms).
- **`decide()`** implements spec §4 exactly (all four worked-example rows traced through the real code): precedence hide-wins → language-gate → only-whitelist → show; language is a standalone gate (no double-counting as an only-family); empty only-set → show; fail-open on unclassifiable.
- **`classifyHost(href, userRules)`** matches §5.2: user rules win over defaults, exact 5-host table, `Article/Blog` fallback, total/never-throws; subdomain/`youtu.be`/case/whitespace/malformed all resolve correctly and the `notyoutube.com` false-positive is rejected.
- **`filter-store`** carries all five FilterState fields, tri-state cycle off→only→hide→off, `storage.sync` round-trip, `myLanguages` seeded+normalized from `navigator.languages`, default no-op.
- **MISSION discipline:** `FacetSelectors` carry an explicit **AMBER "assumption until confirmed on live x.com"** banner, the live-DOM gate (`task-018` → `verify-filter-dom.md`) is real and load-bearing, fixtures are realistic (shared in-memory `chrome.storage` mock; plausible nested-article/t.co structure), and the throw→partial-Facets fail-open path is genuinely tested.

## Refuted (do NOT spend time on this — verified false alarm)

**"Scanner WeakSet dedup ⇒ recycled cells keep a stale verdict (ADR-0010 violation)."** Refuted against the repo's own verified DOM ground truth: X **mounts/unmounts new nodes**, it does not recycle a node in place (`tweet-scanner.ts:19` docstring; `verify-tweet-author-dom.md` CLAIM 6; the `x-caret-menu-live-dom` memory: "X REPLACES the article with a NEW `<article>`"). A new tweet therefore arrives as a fresh node absent from `seen` → the scanner's `addedNodes` path fires → `applier.classify()` runs fresh on a stub-free node. Task-016's wiring satisfies "re-classify on every mount." (Residual nit only: no *integration* test that scanner+applier re-fire on a real mount — see test gaps.)

## Confirmed — worth acting on

### 1. (major) e2e harness can't exercise route-scoped scenarios
`task-017` / `task-016` vs `e2e/content.spec.ts`. The harness only serves `/e2e-harness.html`, but committed `content/filter-applier.ts:66` gates on `isInScope(location)` (`/home`, `/i/lists/*`). On the harness path the filter is **out of scope → never mounts**, so task-017's "cycle a chip → cells collapse to stub" and bar assertions cannot run as written, and task-016's `/home→/explore→/i/lists/123` route scenarios have no harness mechanism. The e2e runs the **real built bundle** (so unlike the unit tests it gets production `isInScope`, not an injected `() => true`).
**Fix:** give the harness a routing story — serve it at `/home` and `/i/lists/123`, or push history state in-page (cleanest, since the bundle reads `location`), or let `isInScope` honor a test override. Specify it in task-017/016 before executing them.

### 2. (minor) `filter-store.persist()` can throw synchronously into the page
`src/core/filter-store.ts:62` — `Promise.resolve(area.set({...})).catch(()=>{})`. JS evaluates `area.set(...)` *before* `Promise.resolve` wraps it, so a **synchronous** throw from `set` escapes `persist()` → `update()` → every page-facing void mutator (`cycle`/`setMode`/`setEnabled`/`setOnlyMyLanguages`/`setMyLanguages`/`setLinkRules`). Violates spec §8 ("storage failures never throw into the page") and §7 ("never load-bearing"). The one failure test uses a *rejected promise* (the path `.catch()` already handles), so the sync-throw path is untested. (`settings.ts` avoids this because its `set()` is `async` and `await`s.) Realistic blast radius is small — persisted data is always serializable.
**Fix:** `function persist(){ try { Promise.resolve(area.set({[KEY]: state.value})).catch(()=>{}); } catch {} }` + a test where `storage.set` throws synchronously and the mutator does not throw.

### 3. (minor) `route.ts` has no Red test
`isInScope` + the `pushState`/`popstate` route subscription are introduced only inside impl `task-016` with no paired test task — the one pure function gating whether the whole feature is active, untested, breaking the plan's own Red-before-Green discipline. (The applier's *gating wiring* is indirectly covered via an injected `inScope` double; only the URL→boolean mapping is untested.)
**Fix:** add a route-helper test task — `isInScope` true for `/home`, `/i/lists/123`; false for `/explore`, `/search`, a profile, `/i/lists` (no id); and `pushState`/`popstate` fire the change callback. Wire as a `depends-on` for 016.

## Lower-priority (real, cheap)

- **`timeline-filter` footgun (`src/core/timeline-filter.ts` ~L30-73):** a stray `language:*` criterion in `only` mode would make the language family unsatisfiable and **hide every post** — failing *toward hide*, against the §3/§7/§10 "broken classifier must fail toward showing" invariant. Unreachable in v1 (store exposes `onlyMyLanguages` separately and never writes `language:*` into criteria), but nothing in `decide()`/types prevents a future UI/migration from doing so. **Fix:** narrow `CriterionId` to exclude the language family, or have the only-grouping skip `language` defensively.
- **Privacy/data-wipe completeness:** the filter's key `'lasso:filter'` is a local const in `filter-store.ts:7`, **not** registered in `STORAGE_KEYS`. `clearLassoData()` won't wipe it and the Privacy & data surface won't list it. **Fix:** add `filter: 'lasso:filter'` to `STORAGE_KEYS` (+ the sync-wipe path) and reference it from the store.
- **`filter-store.load()` shallow-merges stored shape verbatim** (`{...defaultState, ...raw}`) — a corrupt/partial persisted object flows straight into `decide()`. Low urgency (single writer). Optionally coerce `criteria`/`myLanguages`/`linkRules` types on load.

## Test-coverage gaps (all pass today; add to lock behavior)

- **§4 truth-table fidelity:** the nested "only = AND/OR" tests set `onlyMyLanguages:true` on the shared state, so they exercise spec **Row 4** (gate + only) rather than the pure **Row 3** (gate OFF). Rows 1 ("ja video, only-my-languages ON, empty criteria → show") and 2 ("only-my-languages ON + `kind:video=hide` → hide-wins") aren't asserted directly either. Add Row 1/2/3 as written in spec §4.
- **No single composition test** `extractFacets(throwingElement) → decide() === 'show'` — the verify-by-effect chain MISSION cares about is split across two files and never joined.
- **`FacetSelectors.VIDEO`** is `"videoPlayer, videoComponent"` but only `videoPlayer` is fixtured; the `videoComponent` arm (the one the AMBER note flags) is untested.
- **`hasCard`-with-no-host** path (image/app card → `hasLink:true`, `linkHosts:[]`) is untested; the only card fixture also contains `arxiv.org`.
- **Undetectable-locale set** (`und/zxx/qme/qst/qht/qct/qam` in `timeline-filter.ts:5`) — only `und` is tested and the `qXX` pseudo-codes are asserted as fact with no source note. Add a `lang:'qme' → show` test and/or fold the code set into task-018's "lang attribute reliable" scenario.
- **link-classifier:** add cheap regression assertions for query strings, mixed case, whitespace, and a `notyoutube.com → article` guard.
- **`filter-store` round-trip** silently couples to mock microtask ordering (fire-and-forget shape MISSION warns about); consider exposing/awaiting the persist promise so the test waits for the write to settle.

## Plan hygiene

- `_index.md` still lists **tweet-facets (004/005) as remaining**, but `src/core/tweet-facets.ts` + test already exist untracked — coordination/staleness hazard; mark them in-progress/done to avoid duplication.
- **task-008 contract drift:** the snippet shows `storage?: chrome.storage.StorageArea` and a plain `FilterState`, but the shipped store uses `deps.storage?: StorageLike`, `state: ReadonlySignal<FilterState>`, `setMode(id,mode)`, `setMyLanguages(readonly string[])`. Reconcile 008/010/012/014 contract snippets to the shipped types so downstream UI/options/applier tasks don't encode stale signatures.
- **Breakage-health (§7)** appears only as one impl bullet in task-011 with no scenario/test. Add a task-010 scenario: ">N% of cells classify identically (selector breakage) → bias toward show + surface a breakage signal."
- **On-demand dormancy (ADR-0006)** is asserted only by code placement (objects built inside `start()`); optionally add an assertion that nothing is constructed when un-woken.
