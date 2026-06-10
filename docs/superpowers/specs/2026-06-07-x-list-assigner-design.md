# Lasso — X List Assigner · Design Spec

> Status: **first-pass — partially SUPERSEDED** · Date: 2026-06-07 · Owner: f
> A Manifest V3 Chrome extension to assign tweet **authors** to your X (Twitter) **Lists**, in bulk, from the timeline — minimalist, extensible, swift.
>
> ⚠️ Superseded by the docs-first, research-grounded [blueprint](../../blueprint/2026-06-07-lasso-blueprint.md) and [ADRs](../../adr/) for two key decisions: (1) **DOM automation is the default backend, GraphQL is opt-in** (not GraphQL-default); (2) **authenticated calls run in the content script (same-origin), not the service worker**. See blueprint §0 for the full delta. The product framing below still holds.

---

## 1. Problem & intent

While browsing the X timeline / explore / search, I want to select one or many tweets and
assign their **authors** to a chosen X **List**, without leaving the feed.

X Lists are collections of **accounts**, not tweets. So "assign a tweet to a list" is
implemented as "add that tweet's author to the list." Selecting multiple tweets curates
multiple authors into a List in one action.

### Goals
- Select one tweet (quick action) or many tweets (multi-select) from the live feed.
- Assign the selected authors to an existing List with a swift, keyboard-friendly picker.
- Minimalist, well-designed UI that does not fight X's own visual language.
- Extensible by construction: new bulk actions and new "list backends" plug in cleanly.
- Built test-first (TDD), modern strict TypeScript.

### Non-goals (v1)
- Creating new Lists inline (documented extension point; not built in v1).
- Saving tweets to Bookmarks/Collections (out of scope — different concept).
- Firefox/Edge packaging (Chrome MV3 only; code stays browser-portable).
- Any autonomous/background action without explicit user intent.

---

## 2. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| List backend | **Two strategies behind one `XListApi` interface: DOM automation (default) + internal GraphQL (opt-in)**. **No** official API v2. | API v2 writes require a paid tier (rejected — cost). DOM + GraphQL both reuse the user's existing session. Strategy pattern is the central extensibility seam. |
| Default backend | **DOM automation** | Most policy-conservative: it automates the user's *own* manual "Add to List" actions, human-paced, only on explicit click. See §7. |
| Optional backend | **Internal GraphQL** (`ct0` + bearer → `ListAddMember`) | Faster/no-navigation, but uses private endpoints; opt-in with an in-UI policy caveat and conservative throttling. |
| Interaction | **Per-tweet quick `+List` button + hover-checkbox multi-select + floating action bar + keyboard fuzzy picker** | Matches "flexible & swift": fast one-offs and bulk both supported. |
| List scope (v1) | **Existing Lists only** | Keeps v1 minimalist; create-inline is an extension point. |
| Build | bun + Vite + `@crxjs/vite-plugin` (MV3, HMR) | Modern, fast, HMR for content scripts. |
| Language | TypeScript **strict** | Required. |
| UI | **Preact + `@preact/signals`** in a **Shadow DOM** root | Tiny, fast, reactive; Shadow DOM isolates our CSS from X's. |
| Tests | **Vitest** + `@testing-library/preact` + `happy-dom`; fetch-mocked client; Playwright E2E later | TDD core is pure TS — no extension build needed to run unit tests. |
| Tooling | **Biome** (lint+format) | Single fast modern tool. |

Open (defaulted, not vetoed): interaction model and v1 list scope above.

---

## 3. Architecture — small, single-purpose, independently testable units

```
src/
  core/
    auth.ts             page session → Credentials {csrf, bearer}      (pure; fixture-tested)
    x-client/
      types.ts          XListApi interface + domain types (List, Account, AssignResult)
      graphql-api.ts    GraphqlXListApi implements XListApi            (fetch-mocked tests)
      dom-api.ts        DomXListApi implements XListApi via PageDriver (fixture-tested)
      page-driver.ts    thin DOM driver (find/click/wait) — the only impure part of dom-api
      index.ts          selectBackend(settings) → XListApi
    tweet-extractor.ts  article node → TweetAuthor {screenName,userId?,...} (pure; HTML fixtures)
    selection-store.ts  signals: toggle/add/remove/clear, selectMode, derived counts (pure)
    list-cache.ts       fetch+cache user's Lists in chrome.storage; fuzzy search (tested)
    actions/
      types.ts          Action {id,label,icon,run(selection,ctx)} — extensibility seam
      assign-to-list.ts built-in AssignToList action                  (tested w/ fake XListApi)
      registry.ts       register/list actions
    settings.ts         typed chrome.storage wrapper (backend choice, throttle, hotkeys)
  ui/                   Preact components, Shadow DOM, token CSS
    TweetOverlay.tsx    per-tweet checkbox + quick "+List" button
    ActionBar.tsx       floating "N selected · Assign to list ▸"
    ListPicker.tsx      fuzzy, keyboard-first list chooser
    Toast.tsx           result summaries
    theme.css           minimalist design tokens
  content/
    main.ts             MutationObserver: detect tweets, mount overlays, wire store+hotkeys
  background/
    sw.ts               minimal service worker (storage coordination)
  manifest.config.ts    MV3 manifest (host_permissions: x.com, twitter.com; storage)
tests/                  unit/component tests mirror src/ ; fixtures/ HTML+JSON
docs/superpowers/specs/ this spec
```

### Unit contracts (what it does / how to use / depends on)
- **auth**: reads `ct0` cookie + bearer (the public web bearer) → `Credentials`. Depends on `document.cookie` (injected for tests). No network.
- **x-client (`XListApi`)**: `getLists()`, `resolveUserId(screenName)`, `addMember(listId, userId)`, `removeMember(...)`. Two impls; consumers depend only on the interface.
- **page-driver**: `findAddToListControl(article)`, `openListMenu()`, `clickList(name)`, `waitFor(sel)`. Isolates DOM brittleness so `dom-api` logic is testable.
- **tweet-extractor**: `extractAuthor(article: Element): TweetAuthor | null`. Pure.
- **selection-store**: signal-backed set of selected authors keyed by `screenName`; `selectMode` flag; `count`/`isSelected` derived. Pure, framework-agnostic.
- **list-cache**: `getLists({force?})`, `search(query)`. Wraps `XListApi.getLists` + chrome.storage + fuzzy match.
- **actions**: registry of bulk operations over a selection. `AssignToList` is built-in; new actions register without touching UI internals.

### Data flow
observe tweets → `extractAuthor` → user toggles selection (checkbox/hotkey) or hits per-tweet `+List`
→ `selection-store` updates (signals) → `ActionBar` reacts → run `AssignToList`
→ `ListPicker` (from `list-cache`) → on pick, `XListApi.addMember` per author
(`resolveUserId` when `userId` missing) → per-item results → `Toast` summary.

---

## 4. Error handling
- Per-item `AssignResult`: `added | already-member | protected | rate-limited | failed`.
- Summary toast: "Added 3 · 1 already in list · 1 failed".
- `429` → exponential backoff + conservative concurrency cap (see §7).
- Missing/expired auth → "Make sure you're logged in to X."
- DOM backend: if a control can't be found (X markup changed), fail that item with a clear
  message and surface a one-line diagnostic; never hang.

## 5. Testing strategy (TDD, red→green→refactor)
Order (purest/most central first):
1. `selection-store` — pure state machine.
2. `x-client/types` + `GraphqlXListApi` — request building + response parsing (fetch mocked).
3. `auth` — credential extraction from fixtures.
4. `tweet-extractor` — HTML fixtures of real article markup.
5. `list-cache` — caching + fuzzy ranking.
6. `actions/assign-to-list` — against a fake `XListApi` (verifies per-item result handling).
7. `DomXListApi` + `page-driver` — happy-dom fixtures of the add-to-list menu.
8. UI components (`ListPicker`, `ActionBar`) — `@testing-library/preact`.
9. content-script integration — happy-dom.
10. Playwright E2E against built extension — later milestone.

## 6. Extensibility seams
- **Backends**: implement `XListApi` → register in `selectBackend`. (DOM, GraphQL today; API v2 or a mock could be added.)
- **Actions**: implement `Action` → `registry.register(...)`. (AssignToList today; e.g. CreateListThenAssign, Mute, Bookmark later.)
- **UI**: components consume stores/registries, not concrete logic, so new actions appear in the ActionBar automatically.

## 7. Policy & safety (respect X's official policy)
Hard constraints baked into the design:
- **Explicit user action only** — never act autonomously or in the background.
- **User's own session, user's own account** — no third-party credentials, no scraping of
  other users beyond the transient author info needed to perform the requested action.
- **DOM automation is the default** — it automates the user's own legitimate UI actions
  (assistive automation), human-paced with small randomized delays, one menu at a time.
- **GraphQL backend is opt-in** with an in-UI disclosure that it uses X's private endpoints
  and may be inconsistent with X's automation policy; conservative throttle + backoff.
- **Conservative limits** — small batch sizes, capped concurrency, exponential backoff on
  `429`, abort on repeated failures. No mass/rapid-fire automation.
- **Local-only data** — cache only the user's own Lists in `chrome.storage`; no external servers.

## 8. Milestones
1. Scaffold (bun, Vite+crxjs, TS strict, Vitest, Biome) + green sample test.
2. TDD core: selection-store → GraphqlXListApi → auth → tweet-extractor → list-cache → actions.
3. DOM backend + page-driver (TDD with fixtures).
4. UI in Shadow DOM (ListPicker, ActionBar, TweetOverlay, Toast) + content-script wiring.
5. Manual load-unpacked verification on x.com; settings (backend toggle, hotkeys).
6. Playwright E2E; polish; package.

## 9. Risks
- X markup/query-id drift → mitigated by isolating DOM in `page-driver` and centralizing
  GraphQL query ids/features in one config module; both behind `XListApi`.
- `@crxjs/vite-plugin` version friction → unit tests don't depend on the build; if crxjs
  fights latest Vite, fall back to a Vite multi-entry build + static manifest.
- Policy → see §7; default to the conservative DOM path.
