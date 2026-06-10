# Lasso — Technical Blueprint (docs-first, research-grounded)

> Date: 2026-06-07 · Status: **for review** · Grounded in `docs/research/` (6 tracks + 4 verification passes, 13 agents) and two cloned references under `reference/`.
> Lasso is an MV3 Chrome extension: select one or many tweets in the x.com timeline and assign their **authors** to an X **List**. Backend logic is isolated behind one interface with two interchangeable strategies.

---

## 0. What the research changed vs. the first-pass design

| Topic | First guess | Research-grounded decision | Source |
|---|---|---|---|
| Where auth'd calls run | service worker (centralized) | **Content script (same-origin)** — cookies + `ct0` ride along automatically; SW fetch is cross-origin (`chrome-extension://`) and won't carry first-party SameSite auth cookies. Overrides the `easy-twitter-lists` SW+`webRequest` pattern. | 01, 02, verify-01 |
| GraphQL request shape | `queryId` in POST body | **`queryId` in URL path only**; `listId`/`userId` sent as **strings**; `x-twitter-active-user`/`auth-type` headers are *medium* confidence. | verify-04, 04 |
| `rest_id` source | maybe in DOM | **Not in the DOM** — leave `userId` undefined at extract time, resolve lazily via `UserByScreenName`. | 03, verify-03 |
| Default backend | GraphQL (swift) | **DOM automation is the default** (sanctioned UI, no bearer/queryId/transaction-id); GraphQL is **opt-in** with a policy caveat. | 04, verify-04 |
| UI injection | (unspecified) | **Preact tree in an open Shadow DOM**, never `innerHTML` of fetched data (MV3 CSP/XSS); reject reference repo's `innerHTML`+`z-index` injection. | 01, 05 |
| Build tooling | crxjs (assumed fine) | crxjs **2.0-beta** — verify a loadable smoke build first; fallback **WXT** (not the now-deprecated `vite-plugin-web-extension`). | verify-06, 05 |

---

## 1. Layered architecture (5 layers)

- **L1 — Content-script runtime** (ISOLATED world, `https://x.com/*` + `https://twitter.com/*`, `run_at: document_idle`). The heart of Lasso. Hosts the MutationObserver, TweetExtractor, SelectionStore, the Shadow-DOM Preact UI, the Auth provider, and **both** `XListApi` backends. **All authenticated x.com calls happen here** (same-origin).
- **L2 — UI** (Preact + `@preact/signals`) rendered into an **open Shadow DOM** (`host.style.all:'initial'`). Components: `TweetOverlay`, `ActionBar`, `ListPicker`, `Toast`. Subscribe to `SelectionStore` signals.
- **L3 — Actions / orchestration** (`assign-to-list.ts`). Backend-agnostic coordinator: resolves missing `userId`s (cached), calls `addMember` per author, maps results to `AssignResult[]`, enforces policy invariants (human-paced, no self-draining queue, **STOP on rate-limited**, idempotent already-member).
- **L4 — Isolated backend layer** behind `XListApi` (`getLists`, `resolveUserId`, `addMember`, `removeMember`). Two strategies: `DomXListApi` (default), `GraphqlXListApi` (opt-in). A `factory` selects the active one from settings. A **shared contract test** runs against both.
- **L5 — Service worker** (minimal, ESM). Settings/storage orchestration, `storage.onChanged` fan-out, install/onboarding. Holds **no tokens, no long-lived state** (SW dies after ~30s idle). Does **not** make authenticated x.com calls.

**Storage:** `chrome.storage.sync` for small roaming settings (backend strategy, default list, UI prefs — ≤8KB/item); `chrome.storage.local` for the list cache + queryId/feature snapshot; `chrome.storage.session` (SW-only) for volatile run state. **Never** store `ct0`/bearer — read live.

---

## 2. Sequence diagram — EXTRACT tweet/author info

```mermaid
sequenceDiagram
    participant User
    participant MutationObserver
    participant ContentScript
    participant TweetExtractor
    participant SelectionStore
    Note over ContentScript: ISOLATED world on x.com, run_at document_idle
    ContentScript->>MutationObserver: observe(body, childList+subtree), re-acquire on route change
    Note over MutationObserver: x.com timeline is virtualized; rows mount/unmount on scroll
    loop for each mutation batch (coalesced per rAF)
        MutationObserver->>ContentScript: addedNodes
        ContentScript->>ContentScript: gate on article[data-testid=tweet], WeakSet dedupe
        ContentScript->>TweetExtractor: extractAuthor(article)
        TweetExtractor->>TweetExtractor: getTweetType (placementTracking / socialContext / Quote marker)
        opt promoted tweet
            TweetExtractor-->>ContentScript: null (skip ad)
        end
        TweetExtractor->>TweetExtractor: parse first User-Name permalink /<handle>/status/<id>
        TweetExtractor->>TweetExtractor: read displayName (first profile link, expand img alt)
        alt rest_id present in DOM
            Note over TweetExtractor: rest_id is NOT a DOM attribute on x.com
        else rest_id missing (default)
            TweetExtractor-->>ContentScript: {screenName, displayName, tweetId, avatarUrl}, userId undefined
        end
        ContentScript->>ContentScript: inject TweetOverlay checkbox into article (once)
    end
    User->>ContentScript: click select checkbox on a tweet
    ContentScript->>SelectionStore: toggle(author)
    SelectionStore-->>ContentScript: count signal updates
    Note over SelectionStore: userId resolved lazily later via resolveUserId(screenName)
    ContentScript-->>User: ActionBar shows selection count
```

---

## 3. Sequence diagram — ASSIGN selected authors to a List (both backends)

```mermaid
sequenceDiagram
    participant User
    participant ActionBar
    participant AssignAction
    participant XListApi
    participant XServer
    Note over XListApi: interface seam; DomXListApi default, GraphqlXListApi opt-in
    User->>ActionBar: pick target List, click Add to List
    ActionBar->>AssignAction: run(authors, listId, api)
    loop for each selected author (human-paced, one gesture = one run)
        opt userId unknown
            AssignAction->>XListApi: resolveUserId(screenName)
            XListApi-->>AssignAction: rest_id (cached)
        end
        AssignAction->>XListApi: addMember(listId, userId)
        alt GraphQL backend
            XListApi->>XServer: POST /i/api/graphql/<queryId>/ListAddMember
            Note over XListApi,XServer: headers authorization Bearer + x-csrf-token=ct0, credentials include
            XServer-->>XListApi: data.list or errors[]
        else DOM backend (default)
            XListApi->>XServer: click caret on tweet
            XServer-->>XListApi: Dropdown menu opens
            XListApi->>XServer: click Add/remove from Lists menuitem
            XServer-->>XListApi: List dialog opens
            XListApi->>XServer: toggle target list row (if not already checked)
            XListApi->>XServer: click Save / confirmationSheetConfirm
            XServer-->>XListApi: toast / dialog closes
        end
        alt added ok
            XListApi-->>AssignAction: resolve (added)
        else already a member
            XListApi-->>AssignAction: throw XApiError already-member
            Note over AssignAction: idempotent success, do not retry
        else rate limited (429 code 88)
            XListApi-->>AssignAction: throw XApiError rate-limited
            Note over AssignAction: read x-rate-limit-reset, STOP the run
        end
        AssignAction->>AssignAction: record AssignResult {author, outcome}
    end
    AssignAction-->>ActionBar: AssignResult[]
    ActionBar->>User: Toast summary (added N, already-member M, rate-limited stop, failed K)
```

---

## 4. Isolated backend boundaries (the seam the user asked for)

| Module | Responsibility | Interface | Depends on |
|---|---|---|---|
| `core/x-client/types.ts` | The single seam every strategy implements + typed errors | `XListApi {getLists, resolveUserId, addMember, removeMember}`, `XApiError`, `AssignResult`, `GraphqlConfig` | `selection-store` (`TweetAuthor`) |
| `core/x-client/dom-api.ts` | **Default.** Drives sanctioned UI (caret→Add/remove from Lists→toggle→save). Idempotent (checks `aria-checked`). No bearer/queryId/ct0. | implements `XListApi`; injected `PageDriver` | `types`, `page-driver`, `content/selectors` |
| `core/x-client/page-driver.ts` | Thin, fixture-testable DOM driver (`waitForElem`, role/text find, click, human-settle sleep) | `PageDriver {waitForElem, clickCaret, openListsMenu, toggleListRow, commit}` | `content/selectors` |
| `core/x-client/graphql-api.ts` | **Opt-in.** Internal GraphQL; maps HTTP/error envelopes to `XApiError` kinds | implements `XListApi`; `Auth` + `GraphqlConfig` | `types`, `auth`, `graphql-config` |
| `core/x-client/auth.ts` | Reads `ct0` from `document.cookie`; supplies public web bearer. Never reads `auth_token` (HttpOnly, browser-attached) | `Auth {credentials(): {csrf, bearer}}` | `types` |
| `core/x-client/graphql-config.ts` | Centralizes drift-prone queryIds + features; optional MAIN-world sniffer; snapshot is a seed only | `GraphqlConfig`, `sniffConfig()` | `types` |
| `core/x-client/factory.ts` | Selects active backend from settings; only place that knows concrete backends | `createXListApi(strategy, deps): XListApi` | `dom-api`, `graphql-api`, `settings` |
| `core/actions/assign-to-list.ts` | Single-gesture run orchestration + policy invariants | `run(authors, listId, api): Promise<AssignResult[]>` | `types`, `selection-store` |
| `core/tweet-extractor.ts` | Pure extraction `{screenName, displayName, tweetId, avatarUrl}` + variant classify; `userId` undefined | `extractAuthor(article)`, `getTweetType(article)` | `selection-store`, `content/selectors` |
| `core/selection-store.ts` | Reactive selection state (signals) — **already implemented + tested** | `createSelectionStore()` | `@preact/signals-core` |
| `core/list-cache.ts` / `core/settings.ts` | Cache lists + handle→id; typed settings w/ onChanged | `ListCache`, `Settings` | `types` |
| `content/main.ts` + `content/selectors.ts` + `ui/*` | Wire observer→extractor→store; mount Shadow-DOM UI; one centralized selector table | content entrypoint; `Selectors` table | core/* |
| `background/index.ts` | Minimal SW: settings/storage/install. No tokens, no auth fetch. | `onMessage` (`return true`+`sendResponse`), `onInstalled` | `settings` |

---

## 5. Auth flow (corrected)

Content script (same-origin x.com) reads `ct0` from `document.cookie` (`ct0` is intentionally **not** HttpOnly — double-submit CSRF). The public web bearer is a seeded constant (optionally refreshed by sniffing the bundle in MAIN world). `auth_token` is HttpOnly and never read — the browser attaches it automatically on the same-origin fetch. GraphQL backend sets `authorization` + `x-csrf-token: ct0`; CSRF mismatch → 403 code 353. **No** `chrome.cookies` permission and **no** SW fetch needed. `x-client-transaction-id` is increasingly enforced and cannot be hardcoded — a key reason DOM is the default.

## 6. Error handling

Backends throw `XApiError(kind)`: `already-member` (idempotent success), `rate-limited` (429 code 88; read `x-rate-limit-reset`, STOP), `protected`/not-allowed (104 family — do not retry), `auth` (403/353 or 401/32 — prompt re-auth), `not-found` (404 → for GraphQL also a stale-queryId re-discovery trigger), `unknown`. `assign-to-list` maps these to `AssignOutcome` and surfaces a per-item Toast; never silent no-ops; DOM `waitForElem` timeouts fail loudly.

## 7. Policy invariants (enforced in BOTH backends)

One explicit user gesture → one run; human-paced (injected `sleep`+jitter); no batching/self-draining queues; scoped to the user's own session and own data; no off-device redistribution. DOM automation (sanctioned UI) is default. GraphQL opt-in carries an in-UI disclosure that it uses X's private endpoints and may be inconsistent with X's automation policy (a 2026-03 X-Corp DMCA enforces against reverse-engineering these mechanisms). The official paid X API v2 + OAuth is documented as the only fully-compliant path and reserved as a **future** `XListApi` strategy.

## 8. Open product/empirical questions (need a human or a live check)

1. **Retweets:** add the **original author** (default assumption) or the retweeter? — product decision.
2. **UI injection:** always-on static content script (heavier install warning) vs `activeTab` + dynamic injection (lighter)? — UX/permission tradeoff.
3. **Live DOM facts to confirm in DevTools before shipping the DOM backend:** the Lists-membership dialog container + per-list row testids and whether rows expose `aria-checked`; whether the dialog commits on row click or needs an explicit Save; the exact "Add/remove from Lists" menuitem label on web.
4. **Live GraphQL facts (rotate ~2–4 weekly):** current queryIds + complete `features` per op; whether the seeded public bearer is current; how strictly `x-client-transaction-id` is enforced on list mutations.
5. **Build smoke test:** confirm `@crxjs/vite-plugin` 2.0-beta emits a loadable unpacked `dist/` under x.com CSP; else switch to WXT.

## 9. TDD order (red→green→refactor)

1. `selection-store` ✅ (done, 8/8)
2. `x-client/types` + `GraphqlXListApi` (fetch-mocked; **fix:** queryId in URL path, string ids)
3. `auth` (cookie fixtures)
4. `tweet-extractor` (HTML fixtures from saved x.com markup)
5. `list-cache` (cache + fuzzy)
6. `actions/assign-to-list` (against a fake `XListApi` — verifies result mapping + policy stop-on-429)
7. `dom-api` + `page-driver` (fixture menus; against a fake `PageDriver`)
8. **contract test** run against both backends
9. UI components (`ListPicker`, `ActionBar`) via `@testing-library/preact` (assert with `findBy`/`waitFor`)
10. content-script integration (happy-dom)
11. Playwright E2E (`launchPersistentContext` + `--load-extension`); GraphQL route-mocked; **never** write to a real List in CI
