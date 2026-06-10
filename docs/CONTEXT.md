# CONTEXT — Lasso domain language & module map

The shared vocabulary for this codebase. Keep terms consistent in code, tests, and docs.

## Domain terms
- **Tweet** — a post in the x.com timeline; in the DOM an `article[data-testid="tweet"]`. Lasso never "saves a tweet"; it uses the tweet to identify an **Author**.
- **Author / Account** — the user who posted a tweet. The unit added to a List. Identified by **screenName** (handle, no `@`) and, once resolved, a numeric **userId** (`rest_id`).
- **List** — an X List: a collection of **accounts** (not tweets). Identified by **listId** + name.
- **Selection** — the set of Authors the user has currently picked. Lives in **SelectionStore** (signals), keyed case-insensitively by screenName, deduped.
- **Select mode** — UI mode where per-tweet checkboxes are active for bulk picking.
- **Assign** — adding the selected Authors to a target List. Produces one **AssignResult** per Author.
- **AssignOutcome** — `added | already-member | protected | rate-limited | failed`. `already-member` is treated as idempotent success.
- **Backend / Strategy** — a concrete `XListApi` implementation. Two exist: **DomXListApi** (default, sanctioned UI automation) and **GraphqlXListApi** (opt-in, internal GraphQL).
- **PageDriver** — the thin DOM-interaction layer the DOM backend drives; faked in tests.
- **Selectors table** — the single centralized map of x.com DOM hooks (`content/selectors.ts`); the one place to fix on an X redesign.
- **GraphqlConfig** — centralized, drift-prone queryIds + per-op `features`; seeded snapshot + optional runtime sniffer.
- **Credentials** — `{ csrf, bearer }`. `csrf` = `ct0` cookie; `bearer` = public web bearer. `auth_token` is never read (HttpOnly, browser-attached on same-origin fetch).

## Module map (single-purpose units)
```
core/selection-store   reactive selection (done)        core/tweet-extractor   article -> author (pure)
core/x-client/types    XListApi seam + errors           core/x-client/auth     ct0 + bearer
core/x-client/dom-api  default backend (UI automation)  core/x-client/page-driver  DOM driver
core/x-client/graphql-api  opt-in backend               core/x-client/graphql-config  ids/features
core/x-client/factory  pick backend from settings       core/actions/assign-to-list  orchestrate + policy
core/list-cache        list + handle->id cache          core/settings          typed storage.sync
content/main           wire observer/store/UI           content/selectors      DOM hook table
ui/*                   Preact in Shadow DOM             background/index       minimal SW
content/get-focused-tweet  read X's native j/k cursor   content/keyboard       Alt+key dispatcher + DEFAULT_KEYMAP
core/x-client/caret-actions  mute/not-interested/block via the "..." menu
core/x-client/lists-provider  fetch owned Lists (v1.1)
```

## Keyboard terms (docs/blueprint/2026-06-09-keyboard-layer.md)
- **Focused tweet** — the article X's native `j`/`k` cursor points at; read (never moved) by `getFocusedTweet`.
- **Combo** — a canonical binding string like `Alt+m` / `x`; `DEFAULT_KEYMAP` maps combos → commands.
- **Command** — `mute | not-interested | add-to-list | block | toggle-select | toggle-select-mode`.
- **Caret actions** — quick actions driven through the tweet "..." dropdown (mute/not-interested/block), with per-action confirmation handling.

## Invariants
- Authenticated x.com calls run in the **content script** (same-origin). The SW holds no tokens, no long-lived state.
- One explicit user gesture → one assign run. Human-paced. STOP on rate-limited. No self-draining queue.
- UI is a Preact tree in an **open Shadow DOM**; never `innerHTML` of fetched data.
- Consumers depend only on the `XListApi` interface — backends are interchangeable and covered by a shared contract test.
