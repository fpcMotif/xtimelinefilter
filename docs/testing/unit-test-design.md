# Lasso — Comprehensive Unit-Test Design (100% coverage goal)

**Status:** design only — no tests implemented or run yet.
**Coverage goal:** 100% statements / branches / functions / lines, enforced as
`thresholds` in `vitest.config.ts` (build fails below 100%).
**Convex:** the repo has **no `convex/` directory and no Convex dependency** today, so
there is nothing to simulate. §12 specifies the harness to use the moment Convex
functions land (per the redesign brief), so the 100% policy extends to them on day one.

Conventions used below:

- **[gap]** — module already has a suite; this case is missing from it.
- **[new]** — module has no suite at all; whole table is new.
- **⚠ bug-trap** — the case encodes *intended* behavior that the current
  implementation likely violates. Expect it to FAIL when first run; that failure is
  the point. Fix the code, not the test.
- Every fake is injected through the existing seams (`StorageLike`, `XListApi`,
  `PageDriver`, `fetch`, `sleep`, `random`, `doc`, `getCookie`). No module mocking
  except where stated (entry points, chrome APIs).

---

## 1. Coverage policy

| Setting | Value | Rationale |
|---|---|---|
| provider | `v8` (`@vitest/coverage-v8`) | matches vitest 4 |
| include | `src/**` | everything ships |
| exclude | `src/types/**` | ambient `.d.ts`, no runtime code |
| thresholds | 100 / 100 / 100 / 100 | the stated goal; no per-file exemptions |

No `/* v8 ignore */` comments are permitted without a written justification in the PR.
The two live-DOM boundary files (`dom-page-driver.ts`, `caret-actions.ts`) are **not**
exempt — they are driven against synthetic x.com fixtures (the existing pattern).

**Testability refactors required to make 100% honest (§11):** `src/content/main.tsx`
executes `main()` at import time and `src/background/index.ts` registers chrome
listeners at import time. Both stay coverable only via import-under-mocks
(`vi.resetModules()` + a chrome shim). That works but is brittle; §11 prescribes a
minimal extraction so logic is import-safe. Either way, no file is excluded.

---

## 2. Storage-backed modules (chrome.storage logic)

All four use the in-memory `StorageLike` mock from `tests/setup.ts`. Add to the shared
mock: an **injectable failure mode** (`__failNext("get" | "set")`) and a
**call recorder**, because none of the current tests exercise storage *failure* — and
a Chrome extension hits `QUOTA_BYTES`/transient storage errors in real life.

### 2.1 `src/core/settings.ts` — `tests/core/settings.test.ts`

| # | Case | Expected | Notes |
|---|---|---|---|
| S1 | [gap] persists under the exact key `lasso:settings` | `area.get("lasso:settings")` returns the merged object | key is part of the storage contract; a rename silently wipes user settings |
| S2 | [gap] stored partial (e.g. only `{backend:"dom"}`) merges over ALL defaults | `hotkeySelectMode:"s"`, `activation:"auto"` survive | upgrade path: old stored shape + new default fields |
| S3 | [gap] stored garbage (string / number under the key) | does not throw; defaults win or garbage is ignored — **decide & encode** | current `{...DEFAULT, ...raw}` spreads a string into chars ⚠ bug-trap |
| S4 | [gap] `set()` returns the merged-next value (not the patch) | return value === what `get()` now returns | API contract used by callers |
| S5 | [gap] two sequential `set()` patches compose | both patches present | read-modify-write sanity |
| S6 | [gap] multiple subscribers all notified, each exactly once per `set` | spy counts | |
| S7 | [gap] unsubscribe is idempotent (call disposer twice) | no throw, no further calls | |
| S8 | [gap] a subscriber that throws | **decide & encode**: remaining subscribers still run | current `for…of` loop aborts on first throw ⚠ bug-trap |
| S9 | [gap] `area.set` rejects | `set()` rejects, subscribers NOT notified (don't announce state that didn't persist) | current code notifies only after `await area.set` — verify ordering with the failure mode |
| S10 | [gap] default area is `chrome.storage.sync` | construct with no arg; assert it hit the `sync` mock, not `local` | the zero-arg default path is currently never executed |
| S11 | housekeeping | rename the stale test title `"returns defaults … (DOM backend)"` — default is `"rest"` now | stale title documents wrong behavior |

### 2.2 `src/core/list-cache.ts` — `tests/core/list-cache.test.ts`

| # | Case | Expected | Notes |
|---|---|---|---|
| LC1 | [gap] persists under key `lasso:lists`; fresh fetch overwrites stored value | storage inspected directly | |
| LC2 | [gap] cached **empty array** | **decide & encode**: an empty list result is a valid cache entry OR a documented always-refetch | current `cached?.length` treats `[]` as a miss → a user with zero lists refetches on every call ⚠ bug-trap (perf/rate-limit hazard) |
| LC3 | [gap] loader rejects on a forced refresh | rejection propagates; previously cached value is NOT clobbered | `area.set` is only reached on success — prove it |
| LC4 | [gap] loader rejects on first-ever load (cold cache) | rejection propagates; storage stays empty | |
| LC5 | [gap] corrupted stored value (object, not array) | **decide & encode**: treat as miss and refetch | currently returned as-is to the UI ⚠ bug-trap |
| LC6 | [gap] `search()` does NOT force-refetch | loader called 0 extra times when cache is warm | search must be cheap; the picker calls it per keystroke |
| LC7 | [gap] `search()` is case-insensitive and trims | "  DEV " matches "devtools" | exercises fuzzy integration through the public seam |
| LC8 | [gap] concurrent `lists()` calls on a cold cache | **decide & encode**: loader stampede (called twice) is acceptable or must be coalesced | document whichever; today it stampedes |
| LC9 | [gap] default area is `chrome.storage.local` | zero-arg constructor path executed | coverage of the default parameter |

### 2.3 `src/core/list-usage.ts` — `tests/core/list-usage.test.ts`

| # | Case | Expected | Notes |
|---|---|---|---|
| LU1 | [gap] `record` increments an existing count (1→2→3) and persists under `lasso:list-usage` | storage inspected | current suite only ranks; never asserts persisted shape |
| LU2 | [gap] `record` for two different ids keeps independent counts | | |
| LU3 | [gap] `rank` does not mutate the input array | input deep-equal before/after | `toSorted` should guarantee it — lock it in |
| LU4 | [gap] `rank` with ids absent from counts ranks them after any used list, in API order | | |
| LU5 | [gap] corrupted stored counts (string values → `NaN` math) | **decide & encode**: non-numeric counts treated as 0 | `b.uses - a.uses` with `NaN` makes the comparator inconsistent → arbitrary order ⚠ bug-trap |
| LU6 | [gap] `record` when `area.get` rejects | rejects; does not write garbage | |
| LU7 | [gap] empty `lists` input | returns `[]` | trivial but it's a branch |

### 2.4 `tests/setup.ts` storage mock hardening

The mock itself needs cases (it is test infrastructure, but wrong fakes hide real
bugs): `get(string)` vs `get(string[])` vs `get(null)` parity with real
`chrome.storage` semantics; `set` deep-merge is NOT performed (real chrome replaces
per-key — verify our mock matches); reset between tests. Add a tiny
`tests/infra/storage-mock.test.ts` so a regression in the mock is caught directly.

---

## 3. Pure core logic

### 3.1 `src/core/fuzzy.ts` — `tests/core/fuzzy.test.ts` [new — currently 0 direct tests]

| # | Case | Expected |
|---|---|---|
| F1 | exact match scores 0 (`fuzzyScore("abc","abc")`) | `0` |
| F2 | gaps accumulate: `("ac","abc")` | `1` (skipped `b`) |
| F3 | leading offset counts: `("b","ab")` | `1` |
| F4 | non-subsequence → `null` (`("ba","ab")`, `("aa","a")`) | `null` |
| F5 | empty query → score `0`; `fuzzyRank("")` returns a **copy** in original order (mutating the result must not mutate input) | |
| F6 | whitespace-only query behaves as empty (rank trims) | all items |
| F7 | `fuzzyScore` itself is case-SENSITIVE; `fuzzyRank` lowercases both sides | `("A","a")` → null vs rank matches |
| F8 | rank tie-break: equal scores ordered by `localeCompare` of the key | deterministic order |
| F9 | non-matching items are dropped entirely (not appended) | |
| F10 | unicode: emoji/CJK in names ("日本 dev") — query "日" matches; surrogate-pair query char doesn't corrupt scoring | `for…of` iterates code points but `indexOf` is UTF-16 — harsh case: query "😀" against "x😀" must match |
| F11 | query longer than text → null | |
| F12 | repeated query chars must consume distinct positions: `("ll","hello")` matches, `("lll","hello")` → null | |

### 3.2 `src/core/selection-store.ts` — gaps

| # | Case | Expected | Notes |
|---|---|---|---|
| SS1 | [gap] **extractor-shaped re-add**: first `add({screenName:"a", userId: undefined})` (own property!), then `add({screenName:"a", userId:"123"})` | `list()[0].userId === "123"` | `{...author, ...prev}` lets `prev`'s own `userId: undefined` clobber the freshly resolved id. `extractAuthor` ALWAYS sets `userId: undefined` as an own prop ⚠ bug-trap — the existing "merges newly-known userId" test passes only because its first author omits the key entirely |
| SS2 | [gap] re-add preserves first-seen casing AND first-seen displayName/avatar | per doc comment | |
| SS3 | [gap] `toggle` off→on→off via mixed casing (`"Kim"` then `"kIM"`) | ends deselected, count 0 | |
| SS4 | [gap] `list()` preserves insertion order after a remove+re-add | re-added author goes to the end | Map semantics — encode it |
| SS5 | [gap] signal identity: each mutation publishes a NEW Map (old snapshot unchanged) | capture `selected` via subscribe; previous value not mutated | UI correctness depends on it |
| SS6 | [gap] `count` subscriber fires on add/remove/clear but NOT on `setSelectMode` | spy | |
| SS7 | [gap] `clear()` on empty store | no throw; subscribers may fire once (encode which) | |
| SS8 | [gap] `isSelected` with unknown name | false | |

### 3.3 `src/core/result-summary.ts` — gaps

| # | Case | Expected |
|---|---|---|
| RS1 | [gap] every category present at once → full 5-part line in the fixed order `Added · already · not allowed · failed · rate limit` | exact string |
| RS2 | [gap] `protected` outcome line says "not allowed" (only category whose label diverges from its key) | |
| RS3 | [gap] `summarize` total === results.length even when all map to `failed` | |
| RS4 | [gap] singular counts ("Added 1") — encode that we deliberately do NOT pluralize | locks the copy |

### 3.4 `src/core/actions/assign-to-list.ts` — gaps

| # | Case | Expected | Notes |
|---|---|---|---|
| A1 | [gap] empty `authors` → `[]`, `addMember` never called, `sleep` never called | |
| A2 | [gap] `protected` XApiError → outcome `protected`, run CONTINUES | only already-member/rate-limited/unknown are covered today |
| A3 | [gap] `auth` XApiError → outcome `failed` (falls through to default) | encodes that auth errors don't masquerade as something gentler |
| A4 | [gap] result `message` carries `e.message` for Error and `String(e)` for non-Error throw (e.g. `throw "boom"`) | both branches of the ternary |
| A5 | [gap] rate-limited result itself is INCLUDED in results (the author that hit the wall is reported) | `results.length === i+1` |
| A6 | [gap] pacing math: `jitter:0` → exactly `delayMs`; `random:()=>0` → `0.7×`; `random:()=>1` → `1.3×`; result is `Math.round`ed | bounds of the jitter window |
| A7 | [gap] default `delayMs` 700 and default jitter 0.3 reach `sleep` when only `sleep`+`random` injected | covers the `??` defaults |
| A8 | [gap] default `sleep` (no injection) uses a real timer — fake timers (`vi.useFakeTimers`), 2 authors, assert pending until `advanceTimersByTime` | covers the default-sleep lambda |
| A9 | [gap] sleep happens BEFORE the failing add too (pacing is positional, not success-based) | order spy: `add(0), sleep, add(1 throws), sleep, add(2)` |
| A10 | [gap] `sleep` rejection propagates (no swallow) | run aborts mid-way — **decide & encode** partial-results vs rejection; today it rejects losing results ⚠ design decision to pin |

---

## 4. x-client backends

### 4.1 `src/core/x-client/auth.ts` — gaps

| # | Case | Expected | Notes |
|---|---|---|---|
| AU1 | [gap] ct0 anywhere in a multi-cookie jar, with/without spaces (`"a=1;ct0=tok; b=2"`) | found | |
| AU2 | [gap] cookie value containing `=` (`ct0=ab=cd`) | `"ab=cd"` | slice-after-first-eq behavior |
| AU3 | [gap] flag cookie without `=` named exactly `ct0` | **decide & encode**: must be treated as missing → auth error | today `eq===-1` makes key `"ct0"` and returns the string `"ct0"` as the csrf token ⚠ bug-trap |
| AU4 | [gap] name-prefix non-match: jar `xct0=evil; act0=evil` | auth error (no substring match) | |
| AU5 | [gap] empty value `ct0=` | **decide & encode**: empty string is falsy → auth error (good) — lock it | |
| AU6 | [gap] malformed percent-encoding (`ct0=%E0%A4%A`) | `decodeURIComponent` throws URIError — **decide & encode**: wrap as `XApiError("auth")` instead of leaking URIError ⚠ bug-trap | |
| AU7 | [gap] `credentials()` re-reads the jar every call (rotate ct0 between two calls) | second call sees the new token | lazily-read contract relied on by RestXListApi |
| AU8 | [gap] default `getCookie` reads `document.cookie` | set a cookie in happy-dom; zero-arg path | covers the default lambda |
| AU9 | [gap] error has `kind === "auth"` and `name === "XApiError"`, `instanceof XApiError` | typed-error contract incl. prototype chain after class transpile |

### 4.2 `src/core/x-client/rest-api.ts` — gaps

| # | Case | Expected | Notes |
|---|---|---|---|
| R1 | [gap] `removeFromList` POSTs `lists/members/destroy.json` with `list_id`+`screen_name` | body + URL asserted | only create/mute/block covered today |
| R2 | [gap] body is form-encoded (`content-type: application/x-www-form-urlencoded`, special chars `screen_name=a+b%26c` encoded by URLSearchParams) | exact body string | |
| R3 | [gap] `credentials:"include"` and all four auth headers on every write | | header contract is currently asserted only for addToList |
| R4 | [gap] 200 + `errors:[{message:"…already a member…"}]` → `already-member` | regex branch (`already a member|already added`) — test both phrasings | |
| R5 | [gap] 200 + errors with code 32 → `auth`; code 89 → `auth` | both codes | |
| R6 | [gap] 200 + errors with neither → `unknown`, message joined with `; `; empty messages → `"v1.1 error"` fallback | |
| R7 | [gap] 401 vs 403 → `auth` with status in message | both statuses |
| R8 | [gap] 500 with non-JSON body → `unknown`, `"HTTP 500"` | the `try { res.json() } catch` branch |
| R9 | [gap] 200 with non-JSON body | resolves (json undefined, res.ok) | |
| R10 | [gap] `RestXListApi` constructor never throws when `getCreds` throws; the throw surfaces on the first call (`addMember` rejects with the auth error) | lazily-read creds contract |
| R11 | [gap] `RestXListApi.removeMember` and `getLists` delegate (getLists → ownerships endpoint, via injected fetch) | wiring |
| R12 | [gap] `resolveUserId` resolves `null` and performs NO fetch | |
| R13 | [gap] `getCreds` is called per-request (rotate ct0 between two adds → second request carries new header) | pairs with AU7 |

### 4.3 `src/core/x-client/graphql-api.ts` — gaps

| # | Case | Expected | Notes |
|---|---|---|---|
| G1 | [gap] `addMember` SKIPS resolution when `author.userId` present (no UserByScreenName fetch) | fetch called once | |
| G2 | [gap] `removeMember` also resolves when userId missing; throws `not-found` when resolution returns null | symmetric with addMember; only addMember covered today |
| G3 | [gap] `addMember` throws `XApiError("not-found", "Could not resolve @handle")` when resolve → null | message format locked |
| G4 | [gap] classify code 88 → `rate-limited` (json-level, not HTTP) | |
| G5 | [gap] classify code 104 → `protected` | |
| G6 | [gap] classify code 353 → `auth`; code 32 → `auth` | |
| G7 | [gap] multi-error message joined with `" ; "`; all-empty messages → `"Unknown GraphQL error"` | |
| G8 | [gap] "Already a Member" case-insensitive match (classify lowercases) | |
| G9 | [gap] HTTP 401/403 → `auth` before body parsing | |
| G10 | [gap] non-JSON 200 body → resolves; non-JSON 500 → `unknown "HTTP 500"` | both sides of the json try/catch |
| G11 | [gap] `resolveUserId` URL: `variables` JSON includes `screen_name` + `withSafetyModeUserFields:true`; `features` is the config object; queryId in path | parse the URLSearchParams back out — don't string-match the whole URL |
| G12 | [gap] `resolveUserId` returns null when `rest_id` is missing / non-string (number) | type guard branch |
| G13 | [gap] `getLists` rejects `XApiError("unknown", /not implemented/)` | pins the TODO so silent breakage is impossible |
| G14 | [gap] mutate body: `variables.listId`/`userId` are **strings** even when constructed from numbers; `queryId` echoed in body | `String()` coercion branch |
| G15 | [gap] all four auth headers + `content-type: application/json` on mutations; `credentials:"include"` | |

### 4.4 `src/core/x-client/lists-provider.ts` — gaps

| # | Case | Expected |
|---|---|---|
| LP1 | [gap] 429 → `rate-limited` |
| LP2 | [gap] 500 → `unknown` with status |
| LP3 | [gap] numeric-only `id` (no `id_str`) → stringified; both absent → entry dropped |
| LP4 | [gap] missing `lists` key entirely → `[]` |
| LP5 | [gap] `member_count` mapped to `memberCount`, absent → undefined |
| LP6 | [gap] name present but empty string → dropped (both filter conditions independently exercised) |

### 4.5 `src/core/x-client/dom-api.ts` — gaps

| # | Case | Expected | Notes |
|---|---|---|---|
| DA1 | [gap] `close()` is called even when `toggleList` throws | finally-block contract — a stuck-open dialog blocks every subsequent action ⚠ regression-critical |
| DA2 | [gap] `close()` is called after the `already-member` throw | same |
| DA3 | [gap] `close()` is called when `commit()` throws | same |
| DA4 | [gap] driver call ORDER asserted: open → isChecked → toggle → commit → close (a recorder fake, not independent spies) | order is the policy ("check before toggle") |
| DA5 | [gap] `openListsDialog` rejection propagates and nothing else is called (incl. close — dialog never opened) | current code: close() not reached if open throws — encode deliberately |
| DA6 | [gap] `getLists` with duplicate dialog names → duplicate ids | documents the name-as-id hazard |

### 4.6 `src/core/x-client/dom-page-driver.ts` — gaps (synthetic-DOM)

| # | Case | Expected | Notes |
|---|---|---|---|
| DP1 | [gap] `waitFor` timeout path: menu never appears → rejects `/timed out waiting for/` (use injected `timeoutMs: 10`) | the whole MutationObserver/timeout arm is uncovered |
| DP2 | [gap] async appearance: dialog appended AFTER `openListsDialog` starts → resolves via the observer branch | |
| DP3 | [gap] menu opens but no row matches `ADD_TO_LISTS_TEXT` → `/menu item not found/` | |
| DP4 | [gap] screenName match is case-insensitive (`@KIM` tweet, request "kim") | |
| DP5 | [gap] `rowByName` SUBSTRING hazard: lists "Dev" and "DevOps" — asking for "Dev" must hit the "Dev" row | `includes()` returns the FIRST substring match — with order ["DevOps","Dev"] it toggles the wrong list ⚠ bug-trap; decide exact-trim-match |
| DP6 | [gap] `isChecked` false when: row missing; checkbox missing; `aria-checked="false"`; `"mixed"` | all falsy branches |
| DP7 | [gap] `toggleList` unknown name → `/list "X" not found/` | |
| DP8 | [gap] `commit()` with no Save button → resolves silently (no throw) | encode the “dialog auto-saves” assumption |
| DP9 | [gap] `close()` dispatches a bubbling Escape keydown on body | listener spy |
| DP10 | [gap] `listNames` trims textContent | whitespace-laden fixture |
| DP11 | [gap] no dialog in DOM → `rows()` → `[]` → `listNames` `[]` | guard branch |

### 4.7 `src/core/x-client/caret-actions.ts` — gaps (file was just modified; suite is good but misses these)

| # | Case | Expected | Notes |
|---|---|---|---|
| C1 | [gap] `mute` WITH a confirmation sheet present → sheet is clicked (the `if-present`+present branch) | only the absent branch is covered |
| C2 | [gap] `block` when NO sheet appears within `confirmTimeoutMs` → rejects `/expected a confirmation sheet/` | the `required` throw branch |
| C3 | [gap] caret exists but menu never opens → `/caret menu did not open/` (short `timeoutMs`) | |
| C4 | [gap] environment without `PointerEvent` (delete it from the view) → `activate()` still completes via mouse events; action succeeds | the `typeof PointerEventCtor !== "function"` early-return |
| C5 | [gap] `activate()` on an element whose `scrollIntoView`/`focus` are undefined (plain Element) → no throw | optional-call branches |
| C6 | [gap] `blockMatch` all three tiers independently: descendant `[data-testid="block"]`, row itself `data-testid="block"`, text `"Block @user"`; and NOT matching "Unblock" | `/^\s*block/i` vs "unblock" — verify the anchor actually rejects it |
| C7 | [gap] `muteMatch` text tier matches "Mute @user" AND "Unmute @user" (regex `(un)?mute`) | encode deliberately: caret menu shows Unmute for already-muted — clicking it UNmutes ⚠ decide if that's wanted |
| C8 | [gap] `notInterested` when `cellEl` is null AND the menu/row stay connected → rejects `/did not activate/` | null-cell failure arm |
| C9 | [gap] `notInterested` when `cellEl` is null and menu disconnects → resolves | null-cell success arm |
| C10 | [gap] follow-up panel: `findShowFewer` prefers localized text over position (panel ordered [undo, X, fewer-by-text]) | byText priority |
| C11 | [gap] follow-up panel with only 2 buttons (no text match) → no click, but resolves if menu closed | `outside.length >= 3` branch |
| C12 | [gap] buttons inside a *different* article in the same cell are excluded (`!b.closest("article")`) | filter branch |
| C13 | [gap] `menuForRow`: row NOT inside Dropdown/menu (orphaned) → falls back to the opened menu | `?? fallback` branch |
| C14 | [gap] zh-Hant texts: `減少顯示` matches SHOW_FEWER_TEXT, `復原` matches UNDO_TEXT and is never clicked | the verified-live locale |
| C15 | [gap] error message lists row labels truncated to 24 chars, ` | `-joined | exact format already relied on for debugging |
| C16 | [gap] `mute`/`block` propagate `openMenu` failure unchanged | |

### 4.8 `src/core/x-client/graphql-sniffer.ts` — gaps

| # | Case | Expected |
|---|---|---|
| SN1 | [gap] malformed `features` JSON in query string → op still returned, features undefined (catch branch) |
| SN2 | [gap] non-JSON body → features undefined (second catch) |
| SN3 | [gap] body JSON without `features` key → undefined |
| SN4 | [gap] query-string features WIN over body features when both present (body not consulted) |
| SN5 | [gap] relative URL (`/i/api/graphql/QID/Op`) parsed via the `https://x.com` base |
| SN6 | [gap] `config()` returns defensive copies — mutating the returned `ops`/`features` does not affect the next `config()` |
| SN7 | [gap] `record` with garbage URL ("not a url at all") → no-op, no throw |
| SN8 | [gap] `wrapFetchWithSniffer` with `Request` object input and with `URL` input (only string is covered) |
| SN9 | [gap] non-string body (FormData/undefined) → recorded with null body, still delegates |
| SN10 | [gap] sniffer.record throwing → request STILL delegates (the try/catch armor) — inject a sniffer whose record throws |
| SN11 | [gap] wrapped fetch returns the original's return value and passes `init` through untouched |

### 4.9 `src/core/x-client/graphql-config.ts` + `factory.ts` + `types.ts` [new]

- **GC1** snapshot test: `DEFAULT_GRAPHQL_CONFIG` shape — baseUrl is x.com graphql,
  all three tracked ops present and non-empty, features all-boolean. (Pins accidental
  key renames; queryId VALUES are explicitly not asserted — they rotate.)
- **FA1** [gap] unknown strategy string (cast) falls through to `rest` — the defensive
  default branch.
- **TY1** `XApiError`: `instanceof Error` and `instanceof XApiError` after
  transpilation, `name === "XApiError"`, kind preserved for every member of
  `XApiErrorKind`. (Subclassing Error is a classic transpile trap.)

---

## 5. Content-script modules

### 5.1 `src/content/selectors.ts` — `tests/content/selectors.test.ts` [new]

Regexes are logic; they get zero coverage today and they are the highest-churn
contract in the extension.

| # | Case | Expected |
|---|---|---|
| SE1 | `PERMALINK_RE`: `/kim/status/123` → ["kim","123"]; 20-char handle OK; **21-char handle rejected**; handle with `-` rejected; `/kim/status/123/photo/1` still captures; `/i/status/1` matches (`i` is a valid capture — encode deliberately, it's X's own namespace ⚠ decide) |
| SE2 | `ADD_TO_LISTS_TEXT`: "Add/remove from Lists", "Add / remove @kim from Lists", "Add to list" all match; "Add to Bookmarks" doesn't |
| SE3 | `MUTE_TEXT` anchored: "Mute @kim" ✓, "Unmute" ✓, "Commute" ✗ |
| SE4 | `UNDO_TEXT` fully anchored: "Undo" ✓, " 復原 " ✓, "Undo this action" ✗ |
| SE5 | `SHOW_FEWER_TEXT`: all four variants (show fewer / see fewer / 減少顯示 / 减少显示) |
| SE6 | `NOT_INTERESTED_TEXT` matches "Not interested in this post" |
| SE7 | Selectors object: every value is a parseable selector (`document.querySelector` doesn't throw) — guards typos in the one-file-to-fix table |

### 5.2 `src/content/get-focused-tweet.ts` — gaps

| # | Case | Expected |
|---|---|---|
| GF1 | [gap] `aria-activedescendant` id that resolves to NO element → falls through to activeElement |
| GF2 | [gap] active node CONTAINS the tweet (the `querySelector` arm, not `closest`) |
| GF3 | [gap] activedescendant resolves but has no tweet → still tries activeElement (no early null) |
| GF4 | [gap] `:focus-within` final fallback (focus an element inside an article with neither activedescendant nor a tweet-ancestor activeElement) — verify happy-dom supports it or mark the branch with a jsdom-targeted test |
| GF5 | [gap] multiple `[aria-activedescendant]` holders → first one wins (document order) — encode |

### 5.3 `src/content/keyboard.ts` — gaps

| # | Case | Expected | Notes |
|---|---|---|---|
| K1 | [gap] `canonicalCombo`: single bare key ("X" → "x"); messy spacing ("alt +  M" → "Alt+m"); duplicate mods ("Alt+alt+m"); full order ("Shift+Meta+Ctrl+Alt+x" → "Alt+Ctrl+Meta+Shift+x"); multi-char key preserved ("Alt+Enter") | the normalizer is the keymap's integrity |
| K2 | [gap] `eventToCombo` with Ctrl/Meta/Shift mods (only Alt covered) | |
| K3 | [gap] Shift+letter: e.key "X" lowercased → "Shift+x" — so binding "x" does NOT fire on Shift+x | layer test |
| K4 | [gap] `keyFromCode` Digit path: Alt+Digit3 with composed e.key ("£") → "Alt+3" | |
| K5 | [gap] Alt + unrecognized code (e.g. `BracketLeft`, key "˙") → falls back to raw key, no crash | `?? raw` branch |
| K6 | [gap] `isTypingTarget`: `<textarea>`, `<select>`, contentEditable host, `null` target, plain `<div>` → false | only `<input>` covered |
| K7 | [gap] uninstall: returned disposer removes the listener (command not run after) | |
| K8 | [gap] `stopImmediatePropagation` called for owned combos; a second capture listener never sees it | the "only suppress keys Lasso owns" contract — inverse too: unbound key reaches the second listener and `defaultPrevented === false` |
| K9 | [gap] event with no `composedPath` (plain object dispatch) → `?? e.target` branch | |
| K10 | [gap] duplicate combos in keymap → last wins (Map semantics) — encode | config hygiene |

### 5.4 `src/content/tweet-scanner.ts` — gaps

| # | Case | Expected |
|---|---|---|
| TS1 | [gap] `stop()` → tweets added afterwards are NOT reported |
| TS2 | [gap] Element root: observes the element (tweet added inside it reported; added to `document.body` outside it NOT) |
| TS3 | [gap] added wrapper node that both IS a tweet and CONTAINS nested tweets → outer + inner each reported once (matches + querySelectorAll arms in one mutation) |
| TS4 | [gap] article failing extraction (promoted) → no callback, AND marked seen (rescan doesn't retry it) |
| TS5 | [gap] non-Element added node (text node) skipped — the `instanceof` guard |
| TS6 | [gap] `start()` twice — **decide & encode**: double-observe must not double-report (dedupe saves us) |

### 5.5 `src/core/tweet-extractor.ts` — gaps

| # | Case | Expected |
|---|---|---|
| TE1 | [gap] permalink via the `<time>`-closest fallback (no status link in the name block) |
| TE2 | [gap] malformed `href` (`"http://["`) → `pathnameOf` catch → falls to avatar handle |
| TE3 | [gap] avatar testid present but with the WRONG prefix → null screenName → null author |
| TE4 | [gap] no name block at all → displayName undefined (early return branch in `readDisplayName`) |
| TE5 | [gap] name block present but no link matching `/${screenName}` → falls back to whole-block text |
| TE6 | [gap] display name that collapses to empty after trim → `undefined` (the `raw || undefined` branch) |
| TE7 | [gap] avatar img missing `src` → `avatarUrl` undefined |
| TE8 | [gap] `readText`: nested elements + emoji `<img alt>` + `<svg>` badge text EXCLUDED — svg is nodeType 1 and gets recursed... verify: svg text nodes ARE included by `readText` ⚠ bug-trap (doc comment claims badge svg ignored; the code recurses into any element incl. svg) |
| TE9 | [gap] `getTweetType` promoted-by-ancestor vs promoted-by-socialContext-text — separately |
| TE10 | [gap] `isTweet` with element lacking `getAttribute` (the `?.` guard) — pass a bare object cast |

---

## 6. UI layer

### 6.1 `src/ui/use-signal-value.ts` — `tests/ui/use-signal-value.test.tsx` [new]

| # | Case | Expected |
|---|---|---|
| US1 | renders the initial signal value |
| US2 | updates when the signal changes after mount |
| US3 | unsubscribes on unmount (mutating the signal after unmount: no act warnings / no setState-on-unmounted) |
| US4 | swapping to a DIFFERENT signal instance re-subscribes and shows the new value (the `[sig]` dep) |
| US5 | synchronous change during the same tick before effect runs — no missed update (signals `subscribe` fires immediately with current value; assert no stale initial) |

### 6.2 `src/ui/mount.tsx` — `tests/ui/mount.test.tsx` [new]

Pre-req: verify happy-dom supports `CSSStyleSheet.replaceSync` + `adoptedStyleSheets`;
if not, shim them in `tests/setup.ts` (record the shim as test infra).

| # | Case | Expected |
|---|---|---|
| M1 | `sharedStyleSheet()` returns the SAME instance across calls (singleton) |
| M2 | the shadow CSS has NO remaining `:root` (rewritten to `:host`) — assert on the sheet text |
| M3 | `attachShadowRoot`: open mode, adopted sheet attached, mount div inside root |
| M4 | `createUiRoot`: host appended to body, id default `lasso-root` + custom id, `style.all === "initial"` |
| M5 | `render()` renders a vnode into the mount; second render replaces |
| M6 | `destroy()` unmounts (component's cleanup effect runs) AND removes the host from the DOM |
| M7 | two `createUiRoot`s share one stylesheet object (`adoptedStyleSheets[0]` identical) |

### 6.3 `src/ui/picker-state.ts` — gaps

| # | Case | Expected |
|---|---|---|
| P1 | [gap] moveDown/moveUp on EMPTY results (no lists at all) → stays 0, active null, no throw (`clamp(i,0)` branch) |
| P2 | [gap] narrowing the query while activeIndex is deep: index resets via setQuery — but `active` computed with a STALE index against shorter results before setQuery? Encode: `active` never returns undefined (the `?? null`) |
| P3 | [gap] signals are live: subscribing to `results` fires on query change (UI contract) |

### 6.4 `src/ui/ListPicker.tsx` — gaps

| # | Case | Expected |
|---|---|---|
| LP-UI1 | [gap] mouse pick: mousedown on the SECOND option calls `onPick` with it and prevents default (focus retention) |
| LP-UI2 | [gap] ArrowUp at index 0 stays 0 (clamp through the component) |
| LP-UI3 | [gap] Enter with zero results → `onPick` NOT called, no throw (null-active guard) |
| LP-UI4 | [gap] `aria-selected` follows activeIndex after arrow navigation (a11y contract) |
| LP-UI5 | [gap] new `lists` prop → `useMemo` rebuilds state → query cleared (encode: filter resets when reopened with fresh lists) |
| LP-UI6 | [gap] input has `aria-label="Filter your lists"`; dialog role + label present |

### 6.5 `src/ui/ActionBar.tsx` / `Toast.tsx` / `TweetOverlay.tsx` — gaps

| # | Case | Expected |
|---|---|---|
| AB1 | [gap] count transitions 1→0 re-render → bar disappears (not just initial-0) |
| AB2 | [gap] count rendered as text "N selected" for large N (tabular-nums copy lock) |
| TO1 | [gap] Toast has `aria-live="polite"` and is an `<output>` (a11y contract) |
| TO2 | [gap] Toast renders "Nothing to add" for an all-zero summary |
| TW1 | [gap] TweetOverlay click calls `stopPropagation` AND `preventDefault` (x.com must not navigate) — dispatch through a parent listener and assert it never fires |
| TW2 | [gap] `aria-pressed` + accessible label flip with `selected` |

### 6.6 `src/content/app.tsx` — `tests/content/app.test.tsx` [new — zero coverage today]

Fakes: in-memory `XListApi` recorder, `ListCache` stub, `ListUsage` recorder, real
`createSelectionStore`. `vi.useFakeTimers` for the toast timeout. Render with
`@testing-library/preact`.

| # | Case | Expected | Notes |
|---|---|---|---|
| AP1 | "Add to list" click → `listCache.lists({force:true})` called; picker opens with ranked lists when `listUsage` present | force-refresh contract |
| AP2 | no `listUsage` prop → unranked fresh lists shown | optional-prop branch |
| AP3 | `listCache.lists` rejects → picker opens EMPTY (catch branch), no crash, no unhandled rejection | |
| AP4 | `openPickerTick` bump 0→1 opens the picker; re-render with same tick does NOT reopen; tick 0 never opens (the `tick > 0` guard) | keyboard-entry path |
| AP5 | no `openPickerTick` prop → ZERO_TICK default; nothing opens | default-signal branch |
| AP6 | pick flow ORDER: snapshot `selection.list()` BEFORE clearing; picker closes immediately; `usage.record(list.id)` fired; `assignAuthorsToList` called with the snapshot, list, backend | assert the assign receives the pre-clear authors |
| AP7 | selection cleared only AFTER assign resolves (pending promise → still selected) | mid-flight state |
| AP8 | summary toast appears with the run's summary; disappears after exactly 4000ms (fake timers) | |
| AP9 | second run while toast visible → toast replaced; the OLD 4s timer must not prematurely kill the new toast | ⚠ bug-trap: `setTimeout` is never cleared; run A's timer clears run B's toast early — decide & encode (clear previous timeout) |
| AP10 | `listUsage.record` rejecting must not produce an unhandled rejection | `void usage?.record(...)` swallows nothing — ⚠ bug-trap: attach `process.on("unhandledRejection")` guard in the test |
| AP11 | Escape in the picker → `onCancel` → picker closes, selection KEPT | cancel ≠ clear |
| AP12 | `OverlayBinding`: toggling a DIFFERENT author re-renders this binding (count-subscription design) and `selected` stays correct; toggle via the overlay flips selection in the store | the deliberate over-subscription is the contract |
| AP13 | assign rejecting (backend throws synchronously through `assignAuthorsToList` — only possible via `sleep` injection absence… in practice assign never rejects except sleep; encode current truth) | pins error-handling expectations |

---

## 7. `src/content/main.tsx` — `tests/content/main.test.ts` [new — entry point, zero coverage]

Import-time execution requires: `vi.resetModules()` per test, chrome shim extended
with `runtime.onMessage` (see §9), happy-dom document, and `vi.mock` ONLY for
side-effect-heavy collaborators where injection is impossible (none — all collaborators
are real modules that work in happy-dom; mock `fetch` on window instead).

| # | Case | Expected | Notes |
|---|---|---|---|
| MN1 | activation `"auto"` (default settings) → after import+microtasks: `window.__lasso.booted === true`, UI root `#lasso-root` in body, scanner active (a fixture tweet present pre-import gets its overlay span `[data-lasso-overlay]`) | the whole happy path |
| MN2 | activation `"on-demand"` (pre-seed `chrome.storage.sync`) → NO `#lasso-root` after import; then dispatch `{type:"lasso-activate"}` through the onMessage mock → root appears | both arms of `main()` |
| MN3 | `lasso-activate` delivered twice → `start()` runs once (`started` latch; single `#lasso-root`) | idempotence |
| MN4 | message of a different/absent `type` → stays inert | guard branch |
| MN5 | `injectOverlay` dedupe: same article scanned twice → ONE overlay span | OVERLAY_FLAG check |
| MN6 | overlay anchors to `[data-testid="User-Name"]`, falls back to the article when absent | `??` branch |
| MN7 | hover tracking: mousemove over a nested quoted article records the OUTER article (while-climb loop) | |
| MN8 | `targetTweet()` priority: focused (aria-activedescendant) beats hovered; hovered used when nothing focused; hovered node REMOVED from DOM → null (the `document.contains` guard) | three branches |
| MN9 | command `toggle-select-mode` (key `s`) flips `selectMode` and touches no tweet (works with NO tweet on screen) | early-return arm |
| MN10 | command with no target tweet → `console.warn` path, no throw | |
| MN11 | command on a tweet whose author can't extract (promoted) → silent return | `!author` arm |
| MN12 | `toggle-select` (key `x`) on a hovered tweet → selection contains the author | |
| MN13 | `add-to-list` (Alt+l): selects the author if not selected (and does NOT deselect if already selected — the `isSelected` guard) and bumps the picker tick | both sub-branches |
| MN14 | `mute` (Alt+m) → POST `mutes/users/create.json` with the author's screen_name via the mocked window.fetch (ct0 cookie pre-seeded) | wiring through auth+rest |
| MN15 | `block` → `blocks/create.json` | block IS wired in runCommand even though unbound in DEFAULT_KEYMAP — encode that reaching it requires a custom keymap (document the mismatch) |
| MN16 | `not-interested` (Alt+n) drives the caret flow (fixture menu) | integration through createCaretActions |
| MN17 | backend failure inside a command (fetch 403) → `console.error` "[Lasso] action failed", no unhandled rejection | catch arm |
| MN18 | settings `backend:"dom"` and `"graphql"` pre-seeded → corresponding backend constructed (observable: graphql add hits `/i/api/graphql/`; dom add opens the dialog) | factory wiring through the entry |
| MN19 | `main()` itself rejecting (make `createSettings().get` blow up by poisoning the storage mock) → `console.error("[Lasso] init failed", …)`, no unhandled rejection | the final `.catch` |

If import-under-mocks proves too flaky for MN14–MN18, apply the §11 refactor FIRST
(extract `start(deps)`), and keep MN1–MN4 as the thin import-time tests.

---

## 8. `src/background/index.ts` — `tests/background/index.test.ts` [new]

Extend the chrome shim (§9) with `runtime.onInstalled`, `action.onClicked`,
`tabs.sendMessage` (vi.fn). Import the module fresh per test via `vi.resetModules()`.

| # | Case | Expected |
|---|---|---|
| B1 | import registers exactly one `onInstalled` listener and one `action.onClicked` listener |
| B2 | firing `onInstalled` → `console.debug` called, nothing else (no storage writes, no fetch — the "no long-lived state" ADR encoded as an assertion) |
| B3 | `onClicked` with `tab.id = 7` → `tabs.sendMessage(7, {type:"lasso-activate"})` |
| B4 | `onClicked` with `tab.id === undefined` (devtools/chrome:// tab) → sendMessage NOT called |
| B5 | `sendMessage` rejecting (no content script on the tab — the everyday case on non-x.com tabs) → rejection swallowed, no unhandled rejection |
| B6 | `onClicked` with `tab.id = 0` → message IS sent (0 is a valid id; the `!== undefined` check, not truthiness — lock it) |

---

## 9. Test-infra work items

1. **Chrome shim expansion** (`tests/setup.ts`): add `runtime.onInstalled`,
   `runtime.onMessage` (with a `__dispatch(msg)` helper), `action.onClicked`
   (with `__click(tab)`), `tabs.sendMessage` (vi.fn, default resolved). Keep it
   minimal and typed like the storage mock.
2. **Storage failure injection** (§2.4).
3. **Unhandled-rejection tripwire**: a setup-level `process.on("unhandledRejection")`
   collector asserted empty in a global `afterEach` — several ⚠ bug-traps above
   (AP10, B5, MN17) depend on it.
4. **Fixture factory consolidation**: tweet-article fixture builders currently live
   inline in 4+ test files; extract `tests/fixtures/tweet-dom.ts` so the harsh DOM
   cases (quoted nesting, promoted, missing avatar) are built once.
5. **Coverage tooling**: add `@vitest/coverage-v8` devDependency; `bun install`
   before the first coverage run.

---

## 10. Suspected real bugs this design is built to expose (fix code, keep tests)

| Ref | Module | Suspicion |
|---|---|---|
| SS1 | selection-store | re-add clobbers a freshly resolved `userId` with `prev`'s own-property `undefined` — `{...author, ...prev}` merge direction is wrong for undefined-valued own props |
| AP9 | app.tsx | toast `setTimeout` never cleared → a previous run's timer hides the next run's toast early |
| AP10 | app.tsx | `void listUsage?.record(…)` → unhandled rejection if storage write fails |
| AU3/AU6 | auth | bare `ct0` flag cookie yields the literal string "ct0" as csrf; malformed %-encoding leaks `URIError` instead of a typed auth error |
| DP5 | dom-page-driver | `rowByName` substring matching toggles the wrong list when one list name contains another |
| LC2 | list-cache | empty-array cache treated as a miss → refetch storm for zero-list users |
| LU5 | list-usage | non-numeric persisted counts → `NaN` comparator → unstable ranking |
| TE8 | tweet-extractor | `readText` recurses into `<svg>` so badge text IS included, contradicting the doc comment |
| S8 | settings | one throwing subscriber starves the rest |
| S3 | settings | non-object stored value spreads element-wise into the settings object |

Each gets fixed in its own commit with the corresponding test flipping red→green.

---

## 11. Testability refactors (small, mechanical, pre-implementation)

1. **`src/content/main.tsx`**: extract `export async function start(deps?)` and
   `export function createCommandRunner(…)`; leave a 5-line import-time entry
   (`main().catch(…)`). All of §7 then tests exported functions; the entry lines are
   covered by one import-smoke test (MN1).
2. **`src/background/index.ts`**: optionally `export function registerBackground(c = chrome)`.
   B1–B6 then run without `vi.resetModules` gymnastics.
3. **No other module needs refactoring** — the DI seams already exist everywhere else.

---

## 12. Convex (forward-looking — nothing to test today)

Verified: no `convex/` directory, no `convex` dependency, no references in `src/`.
When the redesign introduces Convex functions, the policy is:

- Use **`convex-test`** + vitest (`environment: "edge-runtime"` for the convex
  project subdir), one test file per function module, included in the same 100%
  thresholds via a vitest workspace.
- Simulate, don't stub: `convexTest(schema)` with `t.run`/`t.query`/`t.mutation`/
  `t.action`; actions that call external APIs get their `fetch` injected and tested
  for the same taxonomy as the REST backend here (429 / auth / malformed JSON).
- Auth-dependent functions tested with `t.withIdentity(...)` for both the
  authorized and unauthorized arm.
- Scheduler/cron functions: assert scheduled entries via `t.run(ctx => ctx.db…)` and
  `vi.useFakeTimers` advancement per convex-test docs.

---

## 13. Execution order (when implementation is approved)

1. §9 infra (chrome shim, rejection tripwire, fixtures) + coverage config.
2. §11 refactors (main/background extraction) — no behavior change, existing suite green.
3. Pure modules to 100%: fuzzy, selectors, types, keyboard, result-summary (cheap wins, ~40 cases).
4. Storage quartet (§2) — includes the first bug-trap fixes (S3/S8, LC2/LC5, LU5).
5. x-client (§4) — auth/rest/graphql/sniffer/provider, then dom-api/driver/caret.
6. UI (§6) + app (§6.6).
7. Entry points (§7, §8).
8. `vitest run --coverage` — thresholds at 100% must pass; any uncovered line gets a
   case added here first, then implemented (no ignore comments).
