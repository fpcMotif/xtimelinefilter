# CONTEXT — Lasso domain language & module map

The shared vocabulary for this codebase. Keep terms consistent in code, tests, and docs.

## Domain terms
- **Tweet** — a post in the x.com timeline; in the DOM an `article[data-testid="tweet"]`. Lasso has two capabilities over a Tweet: the **List-assign** capability never "saves a tweet" — it uses the tweet only to identify an **Author**; the **Filter** capability treats the Tweet itself as the subject, reading its **Facets** to decide whether to show or hide it (no Author involved).
- **Author / Account** — the user who posted a tweet. The unit added to a List. Identified by **screenName** (handle, no `@`) and, once resolved, a numeric **userId** (`rest_id`). Always the *member*, never the operator — see **Owner**.
- **Owner** — one of *your own* X accounts: the account logged in **at action time**, which owns the List being operated on and is recorded as the actor on every mirrored change. Distinct from **Account/Author** (the member). Identified by numeric **userId** (read from the `twid` cookie) plus a best-effort **screenName** for display.
- **List** — an X List: a collection of **accounts** (not tweets). Identified by **listId** + name. Owned by exactly one **Owner**.
- **Selection** — the set of Authors the user has currently picked. Lives in **SelectionStore** (signals), keyed case-insensitively by screenName, deduped.
- **Select mode** — UI mode where per-tweet checkboxes are active for bulk picking.
- **Assign** — adding the selected Authors to a target List. Produces one **AssignResult** per Author.
- **AssignOutcome** — `added | already-member | protected | rate-limited | failed`. `already-member` is treated as idempotent success.
- **Backend / Strategy** — a concrete `XListApi` mutation implementation. Three exist: **RestXListApi** (current default — X's undocumented web v1.1 endpoints, which may change; ADR-0007), **DomXListApi** (sanctioned UI automation, the conservative alternate; requires a currently visible Tweet and is not fully Author-addressable) and **GraphqlXListApi** (opt-in, internal GraphQL). List discovery is separate in `lists-provider`. Selectable in Settings → "How Lasso talks to X".
- **PageDriver** — the thin DOM-interaction layer the DOM backend drives; faked in tests.
- **Selectors table** — the single centralized map of x.com DOM hooks (`content/selectors.ts`); the one place to fix on an X redesign.
- **GraphqlConfig** — centralized static queryIds + per-op `features`; GraphQL is explicit opt-in. Rotated IDs fail typed and visibly; update only after live verification.
- **Credentials** — `{ csrf, bearer }`. `csrf` = `ct0` cookie; `bearer` = public web bearer. `auth_token` is never read (HttpOnly, browser-attached on same-origin fetch).

## Module map (single-purpose units)
```
core/selection-store   reactive selection (done)        core/tweet-read        known article -> author + facets + identity (one read home; status core private)
core/x-client/types    XListApi mutation seam + errors  core/x-client/auth     ct0 + bearer
core/x-client/rest-api  current default (undocumented web v1.1)  core/x-client/lists-provider  separate List discovery (undocumented web v1.1)
core/x-client/dom-api   conservative alternate (UI automation)  core/x-client/page-driver  DOM driver
core/x-client/graphql-api  opt-in backend               core/x-client/graphql-config  ids/features
core/x-client/factory  pick backend from settings       core/actions/assign-to-list  orchestrate + policy
core/list-cache        Owner-qualified List catalog cache  core/settings        typed storage.sync (face over synced-store)
core/synced-store      one sync key: cache+merge+echo+listener   core/filter-projection  state-derived count + palette catalog
content/main           wire observer/store/UI           content/selectors      DOM hook table
ui/*                   Preact in Shadow DOM             background/index       minimal SW wiring
background/tab-badge-writer  document-bound, ordered toolbar badge writes
content/get-focused-tweet  read X's native j/k cursor   content/keyboard       Alt+key dispatcher + DEFAULT_KEYMAP
core/x-client/caret-actions  mute/not-interested/block via the "..." menu
core/membership-store/types  MembershipStore seam + Owner   core/membership-store/convex  Convex Mirror impl
core/membership-store/null   no-op (Mirror disabled)        core/membership-store/factory  pick impl from settings
core/membership-store/convex-client  reactive client + device key  content/get-current-account  read logged-in Owner (twid)
convex/schema + functions  accounts/lists/members/events    convex/auth  device-key gate
```

## Keyboard terms (docs/blueprint/2026-06-09-keyboard-layer.md)
- **Focused tweet** — the article X's native `j`/`k` cursor points at; read (never moved) by `getFocusedTweet`.
- **Combo** — a canonical binding string like `Alt+m` / `x`; `DEFAULT_KEYMAP` maps combos → commands.
- **Command** — `mute | not-interested | add-to-list | add-to-default-list | block | toggle-select | toggle-select-mode | toggle-filter | toggle-reveal | help | escape | undo`.
- **Caret actions** — quick actions driven through the tweet "..." dropdown (mute/not-interested/block), with per-action confirmation handling.
- **Acceptance signal** — the observable DOM effect proving X registered an action (the caret menu's rows vanish; the Feedback panel appears). Dispatching an event is never proof on its own.
  _Avoid_: "click succeeded", "click landed" (a dispatched click that X ignored looks identical).
- **Verified action** — the driver pattern for every caret action: act → wait for the acceptance signal → one bounded retry → honest failure with cleanup. No success is reported without its signal.
- **Feedback panel** — the article X swaps in for the tweet after not-interested, holding [undo, show fewer from user, irrelevant]. Appears both with and without `data-testid="tweet"`; it never owns a caret — caret ownership, not testid, distinguishes it from a real tweet.
- **Main-world bridge** — the page-context click executor (`content/main-world.ts`) the driver reaches over postMessage, with an at-most-once guarantee (a consumed target attribute counts as delivered).

## Product-surface terms
- **Controller** — `content/controller.ts`, the headless conductor mapping commands/gestures → flows (assign runs, designed failure toasts, undo, quick actions, coaching). Conducts **both** capabilities: the List-assign flow and, behind a fail-open wall, in-page **Filter commands** (`filterCommand`, undo via the shared registry). Fully unit-tested; `main.tsx` only wires DOM events in.
- **Coach** — decaying-hint + onboarding state (`core/coach.ts`): hints show for 7 days or 5 assigns, then the UI returns to camouflage; "Replay intro" resets them.
- **Toast store / Undo registry** — `core/toast-store.ts` (success/info auto-dismiss, danger persists) and `core/undo.ts` (one armed undo, `Z`, 10s window).
- **Picker controller** — `core/picker-controller.ts`, the five designed states (loading/error/empty/no-match/ready), cache-first open, Recent/All-Lists groups, "already in" checks.
- **Canonical strings** — `core/strings.ts`, every verbatim user-facing string (people-counting, past-tense confirmations, literal failures); pinned by `tests/core/strings.test.ts`.
- **Settings / Popup / Options** — `src/options`, `src/popup`: the real disclosure surface and the toolbar state line.

## Membership-mirror terms (docs/adr/0009-convex-membership-mirror.md)
- **Mirror** — the off-to-the-side Convex store. Never the source of truth and never drives X; it records what the extension did against X and caches X's answers. With no **device key** configured it is absent and the extension behaves exactly as before.
- **MembershipStore** — the seam the extension talks to the Mirror through (sibling of `XListApi`): a `ConvexMembershipStore` and a `NullMembershipStore`, chosen by a factory from settings, covered by a shared contract test.
- **Membership snapshot** — the Mirror's record of which **Accounts** are in which **Lists**, keyed by (List, stable member identity). Numeric user ID wins; one tweet ID is the conservative fallback. Handles are display data, never cache keys. The snapshot is lazy: only people actually checked or changed. It supplies cached cross-account "already in" marks; X supplies the active Owner's live marks.
- **Audit event** — an append-only entry for one mirrored change: **Owner**, **List**, **Account**, action (`add | remove`) and **AssignOutcome** (every outcome, including failures), plus a timestamp.
- **Reconcile** — refreshing the Mirror from X's ground truth: per-**Account** on picker open (X's `memberships.json` — which of my Lists contain this person) and per-**Owner** for the List catalog when that Owner is active. X is authoritative; the Mirror mirrors it.
- **Cross-account catalog** — the union of every known **Owner**'s **Lists**. The picker groups Lists by Owner; only the **active Owner** (the one logged into x.com now) has writable Lists this session — the rest are read-only with cached membership shown "as of last use".
- **Device key** — the single secret that authorises writes to your personal Mirror; the one long-lived credential the extension holds.

## Filter terms
- **Filter** — Lasso's second capability: a client-side, display-only narrowing of the timeline. Reads each **Tweet**'s **Facets** and decides show/hide. Never calls X, never acts on X, never load-bearing for the List-assign flow (same posture as the **Mirror**).
- **Filter scope** — the URL routes where the Filter mounts and runs, decided by the pure `content/route.ts isInScope(pathname)` gate: Home (`/home`), List timelines (`/i/lists/<id>`), Bookmarks (`/i/bookmarks` and numeric folders `/i/bookmarks/<folderId>`), and profile timelines (`/<handle>` + post sub-tabs). Everywhere else (Search, notifications, messages, single posts, …) the pill/palette tear down and the applier no-ops. Every timeline in scope shares the same virtualized `cellInnerDiv` / `article[data-testid="tweet"]` structure, so promoting a new one is a route-gate change only; x.com is a SPA, so scope is re-evaluated on each `onRouteChange`, not just page load.
- **Facet** — a classifiable property of a Tweet, read purely from its `article`: independent predicates `{hasText, hasPhoto, hasVideo, hasQuote, hasLink, liked}` + `linkDest` (set of hosts) + `role` (repost) + `lang`. Isolated-world-safe, no network. Read by the `tweet-read` module alongside the Author (one read home; the shared status/identity core is private).
- **Family** — a group of related criteria the Filter offers: Media kind, Link destination, Post role, Engagement, Language.
- **Criterion** — one filterable Facet value the user can switch (e.g. `kind:video`, `linkDest:arxiv`).
- **Filter mode** — the per-Criterion tri-state `off | only | hide`; the UI chip cycles `off → only → hide → off`.
- **Filter projection** — the state-derived read-side views every surface renders, concentrated in `core/filter-projection.ts`: `activeCriteriaCount(state)` (Criteria not `off` + the language gate) and `buildPaletteItems(state)` (the Only/Hide + preset + global-action catalog). Distinct from the *static* `filter-criteria.ts` catalog; pure and data-only (ADR-0003). One home so surfaces cannot diverge (the pill badge and the popup "filters on" count once disagreed when an `off` key survived a preset/external write).
- **Synced store** — `core/synced-store.ts`, the deep module owning cross-context reactive coherence for one storage key (`storage.sync` by default; an `areaName` parameter names the area its injected `area` fronts) (in-memory cache + merge-over-defaults + echo-suppression + the raw `storage-sync.ts` listener). `settings` and `filter-store` are thin reactive faces over it; `settings.get()` is a cached read, `write()` is strict (the filter face wraps it fail-soft per §8; the settings face re-throws — ADR-0009 credential store).
- **Storage conventions** — reactive, merged, cross-context keys go through **syncedStore** (settings, filter). Raw values that need no merge/cache use `StorageLike` directly: Mirror status publishes, reads, and watches `storage.local`; `clearLassoData` stays one-shot. Don't promote either to syncedStore.
- **Filter command** — a transient, reversible in-page filter action (cycle/`setMode` a Criterion, reveal/show-all, apply a preset). Issued from the in-page pill panel, the command palette, or the keyboard, and **conducted** by `content/controller.ts` behind a fail-open wall: a thrown command can't touch the X flow, and a state-changing command arms undo via `core/undo.ts` (one Z, last-wins, shared with assign). Surfaces dispatch via `controller.filterCommand(run)`; the Filter stays non-load-bearing (ADR-0010).
- **Filter preference** — durable whole-system filter config: link rules, my-languages, presets (save/rename/delete), surface visibility, compact mode, and the master **enable** toggle. Set in popup/Options (and the in-page panel's preference controls); edited **directly** on `FilterStore`/`Settings` and synced — **not** conducted. The in-page panel mixes both: command controls route through the conductor, preference controls stay direct.
- **Link rule** — a `host → destination` mapping used to classify a Tweet's outbound links. Built-in defaults cover arxiv/hn/reddit/youtube/github; the user adds more in Options (v1, winning over defaults); any other external host falls back to the generic **Article/Blog** destination.
- **My languages** — the user's allowlist of BCP-47 codes (default seeded from `navigator.languages`). The Language family is a single **"only my languages"** gate: a post whose detected `lang` is outside the set is hidden; a post with no detectable `lang` is shown (fail-open). Per-language only/hide chips are a v2 facet.
- **Hidden cell** — a timeline cell (`div[data-testid="cellInnerDiv"]`) the Filter collapses to a thin "· hidden — show" stub. Never removed from the DOM, always restorable; the Filter only ever toggles this. Chosen over full `display:none` to stay gentle on X's height-based virtualization (ADR-0010). A Hidden cell is **inert for List-assign**: no selection overlay, not click-selectable, skipped by select mode — clicking "show" turns it back into a normal, selectable Tweet. An opt-in, default-off **compact mode** (the popup's "Hide filtered posts completely" toggle) additionally hides the stub so the cell collapses to ~0 height for a clean feed — the node is still never removed, so it stays restorable; this deliberately enters the height-0 regime ADR-0010 deferred and is pending live-DOM verification (`docs/research/verify-filter-virtualization-dom.md`).

## Invariants
- Authenticated x.com calls run in the **content script** (same-origin). The SW holds no X tokens and no long-lived X state; the *only* long-lived credential the extension may hold is the optional Mirror **device key** (ADR-0009).
- The **Mirror** is never the source of truth — X is. The Mirror is optional (absent without a device key), and a Mirror failure never blocks or alters the X flow (assign, undo, toasts).
- One explicit user gesture → one assign run. Human-paced. STOP on rate-limited. No self-draining queue.
- UI is a Preact tree in an **open Shadow DOM**; never `innerHTML` of fetched data.
- Consumers depend only on the mutation-only `XListApi` interface — backends are interchangeable and covered by a shared contract test. List discovery is separate in `lists-provider`.
