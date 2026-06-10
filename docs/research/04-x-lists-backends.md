# Adding an Account to an X List from an MV3 Extension — Two Backends

> Scope: the logged-in user's **own** X session, inside a Manifest V3 extension, automating the
> user's **own** explicit actions (one click = one add), human-paced, no mass/queued automation.
> Goal is *assistive automation* compatible with X's stated automation policy, not a bulk tool.
>
> Two backends are documented:
> - **(A) Internal GraphQL** — call X's private web-app GraphQL endpoints directly.
> - **(B) DOM automation** — drive the real X web UI (caret menu → Lists dialog → toggle → save).
>
> **Recommendation: ship DOM automation as the conservative default.** It uses only the
> sanctioned UI surface, inherits X's own per-action rate limiting and anti-abuse gating, and
> carries the lowest ToS / detection / breakage risk. GraphQL is documented as an optional
> "fast path" with explicit caveats. (Rationale in the Policy section.)

---

## 0. Key facts up front

| Operation | Current queryId (from live bundle) | Method | URL |
|---|---|---|---|
| `ListAddMember` | `vWPi0CTMoPFsjsL6W4IynQ` | POST | `https://x.com/i/api/graphql/vWPi0CTMoPFsjsL6W4IynQ/ListAddMember` |
| `ListRemoveMember` | `cAGvZIu7SW0YlLYynz3VYA` | POST | `https://x.com/i/api/graphql/cAGvZIu7SW0YlLYynz3VYA/ListRemoveMember` |
| `UserByScreenName` | `IGgvgiOx4QZndDHuD3x9TQ` | GET | `https://x.com/i/api/graphql/IGgvgiOx4QZndDHuD3x9TQ/UserByScreenName` |
| `ListsManagementPageTimeline` | `HudcGxZ51woVeGbC1KKazA` | GET | `https://x.com/i/api/graphql/HudcGxZ51woVeGbC1KKazA/ListsManagementPageTimeline` |
| `ListOwnerships` | `oO9-b3v7B59YGCQ-0vSkmg` | GET | `https://x.com/i/api/graphql/oO9-b3v7B59YGCQ-0vSkmg/ListOwnerships` |

queryIds above are from the auto-generated dump of the live web bundle
(`fa0311/TwitterInternalAPIDocument`, `docs/json/API.json`). **They drift** — see §A.6.
They are NOT stable constants; you must rediscover them (§A.6) rather than hardcode.

> Confidence note: these are community-extracted from the obfuscated web bundle, not officially
> documented. Treat exact ids/feature sets as **medium confidence, time-sensitive**. The
> *shapes* (variables keys, response envelope, error envelope) are stable and high confidence.

---

# (A) Internal GraphQL backend

The X web app talks to its own private GraphQL gateway at
`https://x.com/i/api/graphql/<queryId>/<OperationName>`. This is the same surface the SPA uses;
calling it from a content script reuses the logged-in cookies. It is **undocumented and
unsupported** by X (the *documented* product is the X API v2 at `api.x.com`/`docs.x.com`, which
requires a developer app + OAuth and is a different thing entirely).

## A.1 Authentication & required headers

All calls are made **first-party** from within an `x.com` page context so the session cookies
(`auth_token`, `ct0`) are sent automatically. The non-cookie headers the web app sends:

```
authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA
x-csrf-token:   <value of the ct0 cookie>        # MUST equal the ct0 cookie (double-submit CSRF)
x-twitter-auth-type: OAuth2Session                # present when logged in (auth_token cookie set)
x-twitter-active-user: yes
x-twitter-client-language: en
content-type: application/json                     # for POST mutations
```
- The `Bearer` token above is the **public web-app bearer** baked into the JS bundle. It is a
  client constant, not a per-user secret; it is the same for every web visitor and also drifts
  occasionally (rediscover it from the bundle alongside queryIds).
- `x-csrf-token` MUST be read from the `ct0` cookie and echoed in the header (double-submit
  cookie CSRF). In an MV3 content script you can read `document.cookie` for `ct0` only if it is
  not HttpOnly; `ct0` is JS-readable, `auth_token` is HttpOnly (sent automatically by the
  browser, never readable). So: read `ct0` from `document.cookie`, let the browser attach
  `auth_token`.
- `x-client-transaction-id`: newer X builds also send a per-request anti-automation header
  derived in-page. It is often *not strictly required* for these list mutations today, but X has
  been tightening this. If you get 404/403 on otherwise-correct calls, a missing/!valid
  transaction-id is the likely cause. This is a strong argument for the DOM backend.

Headers reference: `trevorhobenshield/twitter-api-client` `twitter/util.py` `get_headers()`
(lines ~120–143): sets `authorization` bearer, `x-csrf-token: cookies.get('ct0')`,
`x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes`,
`x-twitter-client-language: en`.

## A.2 `ListAddMember` (mutation)

- **Method / URL:** `POST https://x.com/i/api/graphql/vWPi0CTMoPFsjsL6W4IynQ/ListAddMember`
- **Body (JSON):**
```json
{
  "variables": { "listId": "1234567890123456789", "userId": "44196397" },
  "features": {
    "profile_label_improvements_pcf_label_in_post_enabled": true,
    "responsive_web_profile_redirect_enabled": false,
    "rweb_tipjar_consumption_enabled": false,
    "verified_phone_label_enabled": false,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
    "responsive_web_graphql_timeline_navigation_enabled": true
  },
  "queryId": "vWPi0CTMoPFsjsL6W4IynQ"
}
```
- `listId` and `userId` are **strings** of numeric snowflake ids. `userId` is the *rest id* of
  the account being added (get it via `UserByScreenName`, §A.4, or from the tweet author object
  already in the page).
- The `features` object is **required** and validated server-side. If it omits a flag the current
  bundle expects, the gateway returns a 400 with
  `"The following features cannot be null: <flag>"` — this is the single most common breakage
  and the reason features must be re-scraped, not hardcoded.

Method/URL/features derived by the doc generator's `to_api()`
(`fa0311/TwitterInternalAPIDocument` `lib/graphql.py` lines 169–198:
`method = "POST" if operationType == "mutation" else "GET"`, URL template
`https://x.com/i/api/graphql/{queryId}/{operationName}`), and the resolved entry in
`docs/json/API.json` (`graphql.ListAddMember`). Variable keys `listId`/`userId` confirmed by
`trevorhobenshield/twitter-api-client` `twitter/account.py:312-313`
(`self.gql('POST', Operation.ListAddMember, {'listId': list_id, "userId": user_id})`) and
`JimLiu/Perch` `Sources/Perch/API/TwitterAPIClient.swift`
(`listAddMember(listId:userId:)` → `variables: ["listId": listId, "userId": userId]`).

- **Success response shape** (envelope is stable; field nesting may vary slightly by build):
```json
{ "data": { "list": { "id": "...", "id_str": "...", "name": "...", "member_count": 42,
                       "members_context": "...", "__typename": "List" } } }
```
The presence of `data.list` (non-null, no `errors`) is the success signal. Do not rely on exact
sub-fields; check `!response.errors && response.data?.list`.

## A.3 `ListRemoveMember` (mutation)

- **Method / URL:** `POST https://x.com/i/api/graphql/cAGvZIu7SW0YlLYynz3VYA/ListRemoveMember`
- **Body (JSON):** identical shape to ListAddMember, different queryId + smaller feature set:
```json
{
  "variables": { "listId": "1234567890123456789", "userId": "44196397" },
  "features": {
    "profile_label_improvements_pcf_label_in_post_enabled": true,
    "responsive_web_profile_redirect_enabled": false,
    "rweb_tipjar_consumption_enabled": false,
    "verified_phone_label_enabled": false,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
    "responsive_web_graphql_timeline_navigation_enabled": true
  },
  "queryId": "cAGvZIu7SW0YlLYynz3VYA"
}
```
- Success: `{ "data": { "list": { ... } } }` (member_count decremented).

Source: `account.py:315-316`; `docs/json/API.json` `graphql.ListRemoveMember`. Feature switch
list from `GraphQL.json` `ListRemoveMember.metadata.featureSwitches`.

## A.4 `UserByScreenName` (query) — resolve @handle → userId (rest id)

Needed because the list mutations take a numeric `userId`, but you often have only the @handle.
(If you already have the tweet's author object in the page DOM/JSON, you can skip this — the
rest id is usually already present.)

- **Method / URL:** `GET https://x.com/i/api/graphql/IGgvgiOx4QZndDHuD3x9TQ/UserByScreenName`
- **Query params** (each value is a JSON string, URL-encoded):
  - `variables = {"screen_name":"jack"}`
  - `features = { ...the per-op feature map... }`
  - (some builds also send `fieldToggles = {"withAuxiliaryUserLabels":false,"withPayments":false}`)
- Full `features` for this op (current bundle):
```json
{
  "hidden_profile_subscriptions_enabled": true,
  "profile_label_improvements_pcf_label_in_post_enabled": true,
  "responsive_web_profile_redirect_enabled": false,
  "rweb_tipjar_consumption_enabled": false,
  "verified_phone_label_enabled": false,
  "subscriptions_verification_info_is_identity_verified_enabled": true,
  "subscriptions_verification_info_verified_since_enabled": true,
  "highlights_tweets_tab_ui_enabled": true,
  "responsive_web_twitter_article_notes_tab_enabled": true,
  "subscriptions_feature_can_gift_premium": true,
  "creator_subscriptions_tweet_preview_api_enabled": true,
  "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
  "responsive_web_graphql_timeline_navigation_enabled": true
}
```
- Example assembled URL:
```
https://x.com/i/api/graphql/IGgvgiOx4QZndDHuD3x9TQ/UserByScreenName
  ?variables=%7B%22screen_name%22%3A%22jack%22%7D
  &features=%7B...%7D
```
- **Response shape (success):**
```json
{ "data": { "user": { "result": {
  "__typename": "User",
  "rest_id": "12",                         // <- this is userId for ListAddMember
  "legacy": { "screen_name": "jack", "name": "jack", "followers_count": 0, "protected": false },
  "is_blue_verified": false
}}}}
```
  Use `data.user.result.rest_id`.
- **Not-found / suspended:** `data.user` is `{}` or `result.__typename == "UserUnavailable"`
  (with a `reason` like `"Suspended"`). Handle both.

Source: `account.py` `Operation.UserByScreenName` (variables `{'screen_name': str}`);
`docs/json/API.json` `graphql.UserByScreenName` (method GET, full feature map above);
`GraphQL.json` `UserByScreenName.metadata.fieldToggles = ["withPayments","withAuxiliaryUserLabels"]`.

## A.5 Listing the user's own / management lists

You need the set of lists the user **owns/can manage** to present the toggle UI. Two ops:

### A.5.1 `ListsManagementPageTimeline` (query) — the lists-management screen feed
- **Method / URL:**
  `GET https://x.com/i/api/graphql/HudcGxZ51woVeGbC1KKazA/ListsManagementPageTimeline`
- **Query params:**
  - `variables = {"count":100}`  (this op paginates; pass `cursor` for more)
  - `features = { ... }` (large timeline feature map — see `docs/json/API.json`
    `graphql.ListsManagementPageTimeline.features`; ~37 flags incl. `rweb_cashtags_enabled`,
    `c9s_tweet_anatomy_moderator_badge_enabled`, `view_counts_everywhere_api_enabled`, the
    `responsive_web_grok_*` family, etc.)
- **Response:** a Twitter "timeline v2" envelope. Lists appear as timeline entries; walk
  `data.viewer.list_management_timeline.timeline.instructions[].entries[]` and pull each entry's
  `content.itemContent.list` (id_str, name, member_count, mode). Owned/subscribed lists are
  grouped into modules. Because the nesting is deep and build-dependent, the robust approach is a
  recursive search for objects with `__typename == "List"` (cf. `twitter-api-client`
  `util.find_key()` philosophy — recursively search for the key instead of hardcoding paths).

### A.5.2 `ListOwnerships` (query) — lists owned by a given user (cleaner for "my lists")
- **Method / URL:** `GET https://x.com/i/api/graphql/oO9-b3v7B59YGCQ-0vSkmg/ListOwnerships`
- **Query params:**
  - `variables = {"userId":"<self rest id>","count":100}` (paginates via `cursor`)
  - `features = { ... }` (same large feature map as ListsManagementPageTimeline)
- **Response:** timeline envelope; entries carry `list` objects you can map to `{id_str, name,
  member_count, mode}`. This is usually the right call to populate "which of MY lists to add to",
  filtered to lists the self-user owns.

Source: `account.py` `Operation.ListOwnerships`
(`{'userId': int}`, queryId in repo `wQcOSjSQ8NtgxIwvYl1lMg` — **note this is the OLD id**, the
live bundle now serves `oO9-b3v7B59YGCQ-0vSkmg`; drift example) and
`Operation.ListsManagementPageTimeline`; resolved `docs/json/API.json` entries
`graphql.ListOwnerships` / `graphql.ListsManagementPageTimeline`.

> To check membership state for the toggle UI you can also use `ListMembers`
> (`queryId vA952kfgGw6hh8KatWnbqw`, per `account.py` constants — also drift-prone) to see if the
> target user is already in a list, OR simply attempt the add and treat "already a member" as a
> no-op success (§A.7).

## A.6 Error shapes

GraphQL errors come back as HTTP 200 (or 4xx) with an `errors` array. Known shapes:

**"Already a member" / not allowed (logical errors, usually HTTP 200):**
The classic v1.1 list error — surfaced through the same logical layer — is code **104**:
```json
{ "errors": [ { "code": 104, "message": "You aren't allowed to add members to this list" } ] }
```
Triggered when: the list isn't owned by the caller, the list is full (max membership), or the
target user has blocked the caller. (Per X devcommunity thread "Cannot Add Member to List I
created (Code=104)": the accepted answer lists exactly these three causes.) Treat 104 as a
**user-facing, do-not-retry** error.

For the GraphQL list mutations specifically, an attempt to add a user who is **already in the
list** typically returns either (a) a success envelope (idempotent no-op) or (b) an `errors`
entry whose `message` contains "already" / "member". Robust handling: **idempotent** — if the
response indicates the user is already a member, surface "already added" and stop; do NOT loop.
(Marked medium confidence: exact GraphQL message string for the already-member case is
build-dependent; the v1.1 104 family above is the well-documented analog.)

**Generic GraphQL error envelope:**
```json
{ "errors": [ {
  "message": "…", "code": <int>,
  "kind": "Permissions" | "OperationError" | "NonFatal",
  "name": "AuthorizationError" | "…",
  "source": "Client" | "Server",
  "extensions": { "name": "…", "source": "…", "code": <int>, "kind": "…",
                  "tracing": { "trace_id": "…" } }
} ] }
```

**Rate limiting (HTTP 429):** When you exceed the per-endpoint window you get HTTP **429** with:
```json
{ "errors": [ { "code": 88, "message": "Rate limit exceeded" } ] }
```
and rate-limit headers on the response:
```
x-rate-limit-limit:     900           # max requests in window
x-rate-limit-remaining: 0             # remaining in current window
x-rate-limit-reset:     1705420800    # unix epoch seconds when window resets
```
Correct handling: read `x-rate-limit-reset`, back off until then (X's own guidance:
`wait_time = max(reset_time - time.time(), 60)`). For an assistive, human-paced extension you
should essentially never hit this — if you do, it's a signal you're automating too aggressively.

> The 429 envelope + headers + handling code are from X's own docs
> (`docs.x.com/x-api/fundamentals/rate-limits`): "Exceeding limits results in a 429 error";
> headers `x-rate-limit-limit/remaining/reset`; `{"message":"Rate limit exceeded"}`. Error
> **code 88 = "Rate limit exceeded"** is the long-standing Twitter/X error code for this
> condition. `twitter-api-client` also records `r.headers` matching `*rate-limit*` per op
> (`account.py:64`).

**Auth/CSRF failures:** HTTP 403 with `errors[].code: 353` ("This request requires a matching
csrf cookie and header") when `x-csrf-token` ≠ `ct0`; HTTP 401 / `code: 32` ("Could not
authenticate you") when the session is invalid. HTTP **404** on the GraphQL path almost always
means a **stale queryId** (the op was renamed/rehashed in a newer bundle) — re-scrape (§A.6).

## A.6 How `<queryId>` is discovered, why it drifts, and how to stay current

**Why these ids exist:** X bundles each persisted GraphQL operation with a content-hash-style
id. Each web build assigns/changes these. `queryId` and the per-op `features`/`fieldToggles`
lists are emitted inline in the JS bundle.

**Discovery pipeline (this is exactly what `fa0311/TwitterInternalAPIDocument` automates):**
1. **Find the bundle URLs.** Fetch `https://x.com/home` (a logged-out fetch is enough), regex the
   HTML for the client-web script tags:
   ```
   https://abs\.twimg\.com/responsive-web/client-web/[a-zA-Z0-9.]*?\.js
   ```
   (Source: `lib/twitter.py` `TwitterHome.get_script_url()`,
   `CLIENT = "responsive-web"`, regex `abs.twimg.com/{CLIENT}/client-web/…\.js`. There is also a
   `<link rel="preload" as="script" … .js>` form parsed by `get_script_res_url()`, and the main
   page references an on-demand chunk index — the api chunk that carries GraphQL ops is one of
   the `ondemand.s` / `api.*` chunks.)
2. **Download the relevant chunk(s)** (`api.<hash>.js` carries the GraphQL op registry; on some
   builds it's split into `main` + `ondemand` chunks).
3. **Parse out each operation.** The bundle contains literals shaped like
   `{queryId:"vWPi0CTMoPFsjsL6W4IynQ", operationName:"ListAddMember",
   operationType:"mutation", metadata:{featureSwitches:[...], fieldToggles:[...]}}`.
   `TwitterInternalAPIDocument`'s `lib/js_parser/js_parser.py` brace-parses the minified JS into a
   tree, and `lib/graphql.py` (`get_graphql`, `marge_exports`) extracts:
   `e.exports = {queryId, operationName, operationType, metadata}` and the
   `…hash="…", e.exports=…` / `params:` forms. A simpler regex that works in practice:
   ```js
   // for each op, the bundle has both pieces near each other:
   // queryId + operationName:
   /"?queryId"?:"([a-zA-Z0-9_-]{22})","?operationName"?:"(\w+)"/g
   // and the metadata feature list for that op
   ```
4. **Resolve feature *values*.** The op only lists *which* feature flags it needs
   (`featureSwitches`). The on/off **values** live in a separate frozen config object in the
   bundle (`Object.freeze({...})`, parsed by `get_feature_switches`/`get_freeze_object`).
   `to_api()` zips them: for each `featureSwitch` name, look up its boolean and emit the final
   `features` map. (`lib/graphql.py:169-198`.)

**Why it drifts:** X ships new web builds frequently. Each can (a) re-hash a `queryId` when the
persisted query changes, (b) **add a new required feature flag** (causing
`"features cannot be null"` 400s), (c) rename an op, or (d) change the bearer token /
add/require `x-client-transaction-id`. Concrete drift evidence in our sources:

| Op | Old id (`twitter-api-client` constants, ~2023) | Current id (live bundle dump) |
|---|---|---|
| `ListAddMember` | `P8tyfv2_0HzofrB5f6_ugw` | `vWPi0CTMoPFsjsL6W4IynQ` |
| `ListRemoveMember` | `DBZowzFN492FFkBPBptCwg` | `cAGvZIu7SW0YlLYynz3VYA` |
| `UserByScreenName` | `sLVLhk0bGj3MVFEKTdax1w` | `IGgvgiOx4QZndDHuD3x9TQ` |
| `ListOwnerships` | `wQcOSjSQ8NtgxIwvYl1lMg` | `oO9-b3v7B59YGCQ-0vSkmg` |
| `ListsManagementPageTimeline` | `nhYp4n09Hi5n2hQWseQztg` | `HudcGxZ51woVeGbC1KKazA` |

Every single id changed — hardcoding them guarantees breakage.

**Strategy to keep current (for an MV3 extension):**
- **Best: harvest at runtime from the page itself.** Because the extension already runs on
  `x.com`, the SPA *makes these exact requests itself*. Two cheap options:
  1. **Sniff the live bundle in-page:** the op registry is in `window`/loaded chunks. Simplest
     robust approach: install a tiny `fetch`/`XMLHttpRequest` wrapper (in the page's MAIN world
     via an injected script) that observes the app's own outgoing
     `/i/api/graphql/<id>/<OpName>` requests and **records `{OpName → {id, features}}`** the
     first time the user navigates the Lists UI. Then replay with the freshly-observed id +
     features. This *never* goes stale because it mirrors exactly what the app sends.
  2. **Parse the bundle:** fetch the `api.*.js` chunk URL (discoverable from the page) and run the
     regex in step 3. Cache `{OpName → id, features, bearer}` in `chrome.storage` with a short
     TTL; refresh on 404/400-null-feature.
- **Fallback / seed:** ship a snapshot of ids+features, but treat 404 (stale id) and
  `"features cannot be null"` (stale feature set) as triggers to re-discover, then retry once.
- **Don't poll a third-party dump in production**, but DO use `fa0311/TwitterInternalAPIDocument`
  as a reference/cross-check during development — it auto-updates via GitHub Actions and shows the
  current shapes.

> The runtime-sniff strategy is the reason the **DOM backend is more robust still**: it requires
> *zero* knowledge of ids/features/bearer because the app supplies them itself.

## A.7 GraphQL backend — policy / ToS analysis

- This uses **private, undocumented endpoints**. X's Developer Agreement & Policy restricts use
  of the X API to the *documented* (`developer.x.com` / `docs.x.com`) surface obtained via a
  registered app; reverse-engineering the internal GraphQL is **outside** that program and not
  sanctioned.
- However, you are acting **as the user, in the user's own authenticated session, on the user's
  own explicit action** (one click → one add). Functionally this is the same network call the
  user's browser would make by clicking. The risk is not "impersonation" but:
  (1) **ToS**: using non-public endpoints / circumventing the official API program;
  (2) **anti-automation**: missing `x-client-transaction-id` or unusual call patterns can trip
  bot heuristics → soft-locks / challenges on the user's account (the devcommunity 104 thread
  describes exactly this kind of account-level lockout after rapid list edits);
  (3) **breakage**: id/feature/bearer drift (§A.6).
- **Mitigations if you use it anyway:** strictly 1 action per explicit user gesture; human pacing
  (no batching/queues); honor 429 `x-rate-limit-reset`; idempotent already-member handling;
  send the full current header set incl. a valid `x-csrf-token`; prefer runtime-sniffed
  ids/features so you mirror the app exactly.
- **Net:** acceptable *only* as an optional fast path for advanced users, clearly secondary to
  DOM automation. It increases ToS and account-safety risk for marginal latency benefit.

---

# (B) DOM-automation backend (recommended default)

Drive the real X web UI exactly as a human would: open the tweet's caret ("...") menu, click
"Add/remove @user from Lists", toggle the target list in the dialog, and save. One user click in
your extension → one scripted pass through this flow → one add. No queues, no batching.

## B.1 Why this is the conservative default
- Uses **only sanctioned UI affordances**; every state change goes through X's own client code,
  which sends the correct queryId/features/bearer/transaction-id automatically.
- Inherits X's own per-action rate limiting and anti-abuse gating — you cannot accidentally
  exceed limits faster than the UI allows.
- **No reverse-engineering**, no drift maintenance for ids/features.
- Lowest detection risk: the traffic is literally the app's own traffic.
- Only real downside: selectors can change (X redesigns) and it's slower — both acceptable for an
  assistive, human-paced tool.

## B.2 The exact user flow & selectors

X uses React with `data-testid` attributes and ARIA labels. The stable anchors below are
confirmed from X DOM-automation references (lucahammer "delete-tweets" gist uses
`[data-testid="tweet"] [aria-label="More"][data-testid="caret"]`, `[data-testid="...Confirm"]`,
and a `MutationObserver` `waitForElemToExist` pattern) and the X client's own action label
"Add/remove from Lists" (confirmed across multiple X clients' localization strings, e.g.
TwidereX `Common.Controls.User.Actions.AddRemoveFromLists = "Add/remove from Lists"`, and the
official Android `AddRemoveFromListsArgs` navigation target in `com.x.navigation`).

> Selector confidence: the **caret** selector and the `*Confirm` button convention are high
> confidence (directly observed in working scripts). The **inner Lists-dialog cell** testids are
> the least stable part of X's DOM (medium confidence) — treat them as "best-known" and always
> back them with label/role/text fallbacks (§B.4). Verify live before shipping.

### Step 0 — locate the tweet element
Each timeline tweet is an `article` under a cell:
```
article[data-testid="tweet"]
```
Scope every subsequent selector to the specific tweet element to avoid acting on the wrong tweet.

### Step 1 — open the caret ("...") menu
```css
article[data-testid="tweet"] [data-testid="caret"]
/* equivalently, the More button: */
article[data-testid="tweet"] [aria-label="More"][data-testid="caret"]
```
Action: `caretEl.click()`. A dropdown `[role="menu"]` (rendered in a portal at body level,
`[data-testid="Dropdown"]`) appears.

### Step 2 — click "Add/remove @user from Lists"
The menu item is a `[role="menuitem"]` inside `[data-testid="Dropdown"]`. X does **not** give
this item a unique testid, so match by its visible text / aria-label, which is localized as
**"Add/remove @<handle> from Lists"** (label key `AddRemoveFromLists`):
```js
const item = [...document.querySelectorAll('[data-testid="Dropdown"] [role="menuitem"]')]
  .find(el => /add\/remove .* from lists/i.test(el.textContent || el.getAttribute('aria-label') || ''));
item?.click();
```
This opens the **List membership** dialog (a modal: `[role="dialog"]`, often
`[aria-labelledby]` titled "Pick a List"/"Lists").

### Step 3 — the list-selection dialog
The dialog is a modal layer:
```css
[aria-labelledby][role="dialog"]            /* the List-membership sheet */
[data-testid="sheetDialog"]                 /* (alt) bottom-sheet variant on some builds */
```
Inside it, each of the user's manageable lists is a row. Best-known testids (verify live):
```css
[data-testid="listMembershipDialog"]        /* container (build-dependent) */
[role="dialog"] [role="button"]             /* generic: each list row is a role=button */
```
Each row contains the list name and a checkbox/selected state indicating current membership.

### Step 4 — toggle the target list
Find the row whose visible name === the list you want, then click it. The row's
`aria-checked`/checkbox state tells you current membership (so you can make this **idempotent** —
only click if not already in the desired state):
```js
const dialog = document.querySelector('[role="dialog"]');
const row = [...dialog.querySelectorAll('[role="button"], [role="menuitemcheckbox"], [role="checkbox"]')]
  .find(el => el.textContent.trim().startsWith(targetListName));
const alreadyMember = row?.getAttribute('aria-checked') === 'true'
  || !!row?.querySelector('[data-testid="checkmark"], svg[aria-label="Selected"]');
if (!alreadyMember) row.click();   // clicking toggles membership (fires ListAddMember internally)
```
On many builds the toggle is **immediate** (clicking the row adds/removes right away and shows a
toast); on others there is a Save/Done step (Step 5).

### Step 5 — save / done (if the dialog has an explicit commit)
If the dialog has a Save/Done button:
```css
[data-testid="listMembershipDialog"] [role="button"]   /* the Done/Save button, match by text */
```
```js
const done = [...document.querySelectorAll('[role="dialog"] [role="button"]')]
  .find(el => /^(done|save)$/i.test(el.textContent.trim()));
done?.click();
```
If a **confirmation sheet** appears (X uses the `*Confirm` convention for confirmations, e.g.
`[data-testid="confirmationSheetConfirm"]`):
```css
[data-testid="confirmationSheetConfirm"]
```
Click it to commit. Then the dialog closes; success is signaled by the modal disappearing and/or
a toast (`[data-testid="toast"]`).

### Optional pre-step — choosing WHICH list when you only have a handle
If your UX lets the user pick the list first, you can read the user's lists from the
`/i/lists` management page DOM, but for the per-tweet flow above the dialog already enumerates the
user's manageable lists — no separate lookup needed. (This is another reason DOM beats GraphQL:
you never have to resolve userId or fetch list ownership yourself.)

## B.3 Content-script-drivable step sequence (human-paced)

Because React renders asynchronously (menus/dialogs mount after a click), each step must
**wait for the next element to exist** before acting. Use a `MutationObserver`-based wait (the
lucahammer gist uses exactly this `waitForElemToExist` pattern). Drive it from a **single user
gesture** — never on a timer/loop:

```js
// waitForElemToExist: resolve when selector appears (MutationObserver), with timeout.
function waitForElem(selector, { root = document, timeout = 4000 } = {}) {
  const hit = root.querySelector(selector);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { obs.disconnect(); reject(new Error('timeout: ' + selector)); }, timeout);
    const obs = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) { clearTimeout(t); obs.disconnect(); resolve(el); }
    });
    obs.observe(root.documentElement || root, { childList: true, subtree: true });
  });
}
const find = (root, pred, sel = '*') =>
  [...root.querySelectorAll(sel)].find(pred);
const sleep = ms => new Promise(r => setTimeout(r, ms));   // tiny human-like settle, NOT a loop

// MUST be called directly from a user click handler in your extension UI (one gesture = one run)
async function addAuthorToList(tweetEl, targetListName) {
  // 1. open caret menu
  const caret = tweetEl.querySelector('[data-testid="caret"]');
  caret.click();

  // 2. click "Add/remove @user from Lists"
  const menu = await waitForElem('[data-testid="Dropdown"]');
  await sleep(120);
  const addRemove = find(menu,
    el => /add\/remove .* from lists/i.test(el.textContent || ''),
    '[role="menuitem"]');
  if (!addRemove) throw new Error('list menu item not found');
  addRemove.click();

  // 3. wait for the list dialog
  const dialog = await waitForElem('[role="dialog"]');
  await sleep(150);

  // 4. toggle the target list (idempotent)
  const row = find(dialog,
    el => el.textContent.trim().startsWith(targetListName),
    '[role="button"],[role="menuitemcheckbox"],[role="checkbox"]');
  if (!row) throw new Error('list "' + targetListName + '" not found in dialog');
  const isMember = row.getAttribute('aria-checked') === 'true'
    || !!row.querySelector('svg[aria-label="Selected"],[data-testid="checkmark"]');
  if (!isMember) row.click();           // performs the add

  // 5. commit if there is a Done/Save or confirmation step
  await sleep(150);
  const done = find(document,
    el => /^(done|save)$/i.test(el.textContent.trim()),
    '[role="dialog"] [role="button"]');
  if (done) done.click();
  const confirm = document.querySelector('[data-testid="confirmationSheetConfirm"]');
  if (confirm) confirm.click();

  return { added: !isMember, alreadyMember: isMember };  // idempotent result
}
```

Pacing rules that keep this "assistive, human-paced":
- **One run per explicit user gesture.** Never call `addAuthorToList` in a `for`/`while`/`setInterval`.
- No queue that drains itself; if the user wants to add many, they click many times.
- The small `sleep()`s are only DOM-settle waits, not a throttle to push volume.
- If any `waitForElem` times out, abort and surface an error — do **not** retry-spam.

## B.4 Selector resilience (because X redesigns)
- Prefer **role + visible text/aria-label** over deep testid chains for the menu item, list rows,
  and Done button (these are the parts X changes most).
- Keep `data-testid="caret"`, `data-testid="Dropdown"`, `role="dialog"`,
  `data-testid="confirmationSheetConfirm"`, `data-testid="toast"` as primary anchors (most
  stable), each with a text/role fallback.
- Centralize all selectors in one config object so a redesign is a one-file fix.
- Detect breakage at runtime (element not found within timeout) and fail loudly with a clear
  message rather than silently doing nothing.

## B.5 DOM backend — policy / ToS analysis
- Uses **only the sanctioned UI**; every mutation flows through X's own client. No private
  endpoints, no bearer/queryId reuse, no header spoofing.
- Inherits X's own anti-abuse gating and rate limits; cannot out-pace the UI.
- Strongly aligned with X's automation policy *when kept assistive*: human-paced, explicit-action
  only, one click = one add, no bulk/aggressive behavior, no unsolicited mass actions. X's
  automation rules prohibit **bulk/aggressive/spammy** automation and manipulation — a tool that
  performs exactly the action the user just clicked, at human speed, on the user's own account,
  is the canonical "good" assistive case.
- Residual risk is essentially the generic one that applies to *any* browser extension that
  scripts a site's UI (selectors break on redesign; the extension must not be repurposed into a
  bulk tool). No private-API or account-lockout risk beyond what the user could trigger by
  clicking themselves.

---

# Policy summary & recommendation

| Dimension | (A) Internal GraphQL | (B) DOM automation |
|---|---|---|
| Endpoint type | Private/undocumented `/i/api/graphql` | Sanctioned UI |
| ToS posture | Outside official API program (riskier) | Uses product as intended |
| Maintenance | High — queryId/feature/bearer/txn-id drift | Medium — selector drift only |
| Anti-bot / account-lock risk | Higher (missing txn-id, odd patterns) | Lowest (app's own traffic) |
| Rate-limit handling | You must honor 429/`x-rate-limit-reset` | Inherited from UI |
| Speed | Faster | Slower |
| Recommended | Optional fast path only | **Default** |

**Recommendation:** Ship **(B) DOM automation** as the default backend. Keep **(A) GraphQL**
behind an opt-in "fast mode" flag for advanced users, implemented with **runtime-sniffed**
ids/features (never hardcoded), full correct headers incl. `x-csrf-token` from `ct0`, idempotent
already-member handling, and strict 429 backoff. In **both** backends enforce the same policy
invariants: **one explicit user action → one add, human-paced, no batching/queues, no mass
automation.**

---

# Sources

Official / primary:
- X API v2 — Add List member: https://docs.x.com/x-api/lists/add-list-member
- X API v2 — Remove List member: https://docs.x.com/x-api/lists/list-members (Manage → Remove)
- X API rate limits (429, `x-rate-limit-limit/remaining/reset`, "Rate limit exceeded", backoff
  code): https://docs.x.com/x-api/fundamentals/rate-limits
- X automation policy: https://help.x.com/en/rules-and-policies/x-automation
  (Cloudflare-gated to direct curl; policy: no bulk/aggressive/spammy automation, assistive
  user-initiated automation permitted)
- X platform-manipulation/spam policy: https://help.x.com/en/rules-and-policies/platform-manipulation
- Chrome MV3 content scripts (for the content-script architecture):
  https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

Community / reverse-engineering (medium/low confidence, time-sensitive):
- `fa0311/TwitterInternalAPIDocument` — auto-generated dump of the live web bundle. Cloned to
  /tmp; key files: `docs/json/API.json` (resolved url/method/features per op),
  `docs/json/GraphQL.json` (per-op `queryId`, `metadata.featureSwitches`, `fieldToggles`),
  `lib/twitter.py` (`get_script_url()` bundle-discovery regex
  `abs.twimg.com/responsive-web/client-web/*.js`), `lib/graphql.py` (`get_graphql`,
  `marge_exports`, `to_api` lines 169-198), `lib/js_parser/js_parser.py` (bundle parser).
  https://github.com/fa0311/TwitterInternalAPIDocument
- `trevorhobenshield/twitter-api-client` (v0.10.22, MIT) — `twitter/account.py:312-316`
  (`add_list_member`/`remove_list_member` → `gql('POST', Operation.ListAddMember,
  {'listId','userId'})`), `twitter/constants.py` (Operation ids — now-stale, used to demonstrate
  drift; `default_variables`, `default_features`), `twitter/util.py:120` (`get_headers`).
  https://github.com/trevorhobenshield/twitter-api-client
- `JimLiu/Perch` — Swift client confirming `ListAddMember` GraphQL op + variables
  `["listId","userId"]` and per-op `features(...)`:
  https://github.com/JimLiu/Perch (Sources/Perch/API/TwitterAPIClient.swift)
- X devcommunity — list add-member error code **104** "You aren't allowed to add members to this
  list" (causes: not owner / list full / blocked) and account soft-lock after rapid list edits:
  https://devcommunity.x.com/t/cannot-add-member-to-list-i-created-code-104/25373
- lucahammer "delete-tweets" gist — X DOM-automation patterns: caret selector
  `[data-testid="tweet"] [aria-label="More"][data-testid="caret"]`, `*Confirm` testids,
  `MutationObserver`-based `waitForElemToExist`:
  https://gist.github.com/lucahammer/1aa16b4d3c1fb04035839da5ef699d65
- "Add/remove from Lists" action label confirmed across X clients:
  TwidereX-iOS `Common.Controls.User.Actions.AddRemoveFromLists`
  (https://github.com/TwidereProject/TwidereX-iOS) and official Android
  `com.x.navigation.AddRemoveFromListsArgs`.
- trekhleb — annotated walkthrough of X internal GraphQL home-timeline requests (header/feature
  shape reference): https://trekhleb.dev/blog/2024/api-design-x-home-timeline/

Caveats: all internal-GraphQL specifics (queryIds, feature flags, bearer token, header set) are
extracted from the obfuscated web bundle and **change without notice**. Re-verify against a live
session before relying on them; the DOM backend avoids this entirely.
