# Adversarial Verification — X Lists backends: GraphQL + DOM automation

Verifier role: independent adversarial re-check of the `04-x-lists-backends.md` synthesis claims.
Date: 2026-06-07. Method: cloned primary repos, fetched official/Wayback docs, GitHub code search.
mgrep --web was UNAVAILABLE (monthly quota exhausted, HTTP 429) — substituted with `gh search`,
`git clone`, `curl` against GitHub raw + Wayback Machine + official error/rate-limit references.

Repos cloned to /tmp/tw-verify:
- trevorhobenshield/twitter-api-client (2023-era snapshot)
- fa0311/TwitterInternalAPIDocument (auto-generated from live bundle; docs/json/*.json)

---

## CLAIM 1 — current queryId/method/URL for the 5 ops are extractable & resolved → CONFIRMED

Verified each of the 5 queryIds against fa0311 `docs/json/GraphQL.json` AND `docs/json/API.json`
(both auto-generated from the live x.com web bundle):

| Op | queryId (live) | method | matches claim? |
|---|---|---|---|
| ListAddMember | `vWPi0CTMoPFsjsL6W4IynQ` | POST | YES |
| ListRemoveMember | `cAGvZIu7SW0YlLYynz3VYA` | POST | YES |
| UserByScreenName | `IGgvgiOx4QZndDHuD3x9TQ` | GET | YES |
| ListsManagementPageTimeline | `HudcGxZ51woVeGbC1KKazA` | GET | YES |
| ListOwnerships | `oO9-b3v7B59YGCQ-0vSkmg` | GET | YES |

API.json entries carry exact `url` (`https://x.com/i/api/graphql/{queryId}/{operationName}`),
`method`, `queryId`, and a per-op `features` map:
- ListAddMember: 6 features (e.g. `profile_label_improvements_pcf_label_in_post_enabled:true`,
  `rweb_tipjar_consumption_enabled:false`)
- UserByScreenName: 13 features
- ListOwnerships: 37 features

`lib/graphql.py:to_api()` (lines 169-198) derives `method = "POST" if operationType=="mutation" else "GET"`
and builds the URL from `{queryId}{operationName}`, exactly as the synthesis states.

CAVEAT: the *exact* per-op feature SET drifts every build; numbers above are a point-in-time snapshot.
fa0311's JSON is the live-derived source of truth, so "fully resolved from the live web bundle" holds.
Source URLs:
- https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/docs/json/GraphQL.json
- https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/docs/json/API.json
- https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/lib/graphql.py (to_api 169-198)

---

## CLAIM 2 — mutations take {listId,userId} + required features; success → {data:{list:{...}}} → CONFIRMED (one nuance)

twitter-api-client `account.py`:
```
def add_list_member(self, list_id: int, user_id: int) -> dict:
    return self.gql('POST', Operation.ListAddMember, {'listId': list_id, "userId": user_id})
def remove_list_member(self, list_id: int, user_id: int) -> dict:
    return self.gql('POST', Operation.ListRemoveMember, {'listId': list_id, "userId": user_id})
```
`gql()` (account.py:47-67) for POST sends body `{'json': {'queryId': qid, 'features': features, 'variables': ...}}`.
So body shape = `{variables:{listId,userId}, features:{...}, queryId}` — matches claim exactly.

NUANCE / minor correction: in this lib the params are typed `int` (`list_id: int, user_id: int`), NOT
string. The synthesis says "string variables {listId,userId}". The live web app sends these as JSON
strings (rest_id values are strings on the wire). Practically the gateway accepts the numeric ids the
lib passes, but the synthesis's "string" wording is the *web-app* convention, not what this reference lib
does. Low-impact; recommend "id values (sent as strings by the web app)".

"features must be exact per-op set or 400 'The following features cannot be null'": the per-op features
requirement is confirmed by API.json carrying a distinct features map per op and `to_api` zipping
featureSwitches→values. The exact 400 error STRING ("features cannot be null") is a well-known X gateway
message but I could not pull it from an official doc page (X docs are JS-hydrated SPAs; community-only).
Treat the error-string wording as medium confidence; the requirement itself is high.

Success-shape `{data:{list:{...}}}`: not independently re-verified against a live response in this pass
(would require authed call). Plausible and consistent with GraphQL op naming, but mark that sub-detail
uncertain.
Source URLs:
- https://github.com/trevorhobenshield/twitter-api-client/blob/master/twitter/account.py (312-316, gql 47-67)
- https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/docs/json/API.json

---

## CLAIM 3 — headers: bearer + x-csrf-token=ct0 + x-twitter-* ; auth_token auto-attached → CONFIRMED
##           (but the x-client-transaction-id CITATION is wrong; the requirement itself is corroborated elsewhere)

twitter-api-client `util.py:get_headers` (120-142) builds exactly:
- `authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=...` (the public web bearer)
- `x-csrf-token: cookies.get('ct0','')` (double-submit; mirrors ct0)
- `x-twitter-auth-type: 'OAuth2Session' if auth_token else ''`
- `x-twitter-active-user: 'yes'`
- `x-twitter-client-language: 'en'`
- `x-guest-token` also present
All match the claim. In a content script, ct0 is JS-readable; auth_token is HttpOnly and attached by the
browser on first-party requests — consistent with the design.

"x-csrf-token must equal ct0 or 403 code 353": CONFIRMED via yourChainGod/xAuth TESTING.md which maps
`353 -> ct0 -> x-csrf-token`. Code 353 = CSRF/ct0 mismatch is standard across X tooling.

x-client-transaction-id: the synthesis CITES trekhleb.dev/blog/2024/api-design-x-home-timeline. I fetched
the full post source (index.mdx, 817 lines) — it is a conceptual REST-vs-RPC-vs-GraphQL essay and contains
ZERO mention of transaction-id, csrf, bearer, or headers. **The trekhleb citation does NOT support the
transaction-id claim.** HOWEVER the requirement is strongly corroborated by other PRIMARY sources:
- mikf/gallery-dl twitter.py sets `"x-client-transaction-id"` in request headers
- ainergiz/xfeed docs/x-client-transaction-id.md: "required for X API mutations (like, bookmark, tweet,
  retweet)... cannot be a random value — must be derived"
- iSarabjitDhiman/XClientTransaction, Lqm1/x-client-transaction-id: dedicated generators
- github/dmca 2026/03/2026-03-27-x-corp.md: X Corp takedown explicitly lists "x-client-transaction-id
  header generation and validation" as a protected anti-bot mechanism it enforces.
So: CLAIM CONTENT = CONFIRMED; CITATION = needs replacement (drop trekhleb for this point).

Source URLs:
- https://github.com/trevorhobenshield/twitter-api-client/blob/master/twitter/util.py (get_headers 120-142)
- https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/twitter.py
- https://github.com/ainergiz/xfeed/blob/main/docs/x-client-transaction-id.md
- https://github.com/iSarabjitDhiman/XClientTransaction
- https://github.com/github/dmca/blob/master/2026/03/2026-03-27-x-corp.md

---

## CLAIM 4 — error shapes: 104 not-allowed/already-member; 429 code 88 'Rate limit exceeded' w/ x-rate-limit-* → CONFIRMED
##           (one embellishment unsupported)

Code 88 = "Rate limit exceeded", HTTP 429: CONFIRMED VERBATIM from official Twitter/X error reference
(Wayback of developer.twitter.com/en/support/twitter-api/error-troubleshooting):
  "Code 88 / Text: Rate limit exceeded. / Description: Corresponds with HTTP 429. The request limit for
   this resource has been reached..."

x-rate-limit-limit / -remaining / -reset, reset in UTC epoch seconds, HTTP 429: CONFIRMED VERBATIM from
official rate-limits doc (Wayback developer.twitter.com/en/docs/twitter-api/rate-limits):
  "x-rate-limit-reset: the remaining window before the rate limit resets, in UTC epoch seconds ... the API
   will return a HTTP 429 'Too Many Requests' response code"

Code 104 = "You aren't allowed to add members to this list": CONFIRMED VERBATIM from the cited
devcommunity thread:
  "TweepError: [{message: 'You aren't allowed to add members to this list', code: 104}]" and causes listed
  (you don't own the list / list is at membership cap / target blocked you). do-not-retry guidance is sound.

twitter-api-client captures rate-limit headers per-op: `self.rate_limits[op] = {k:int(v) ... if 'rate-limit'
in k}` (account.py:64) — confirms header capture (the claim cited account.py:64).

UNSUPPORTED EMBELLISHMENT: the synthesis says the code-104 thread "documents lockouts after rapid list
edits." The thread does NOT mention account lockouts/soft-locks — it only covers ownership/cap/block causes
of 104. Recommend removing that attribution.

Code 353 = CSRF: see Claim 3 (community-confirmed, not in the official v1.1 error table).

Source URLs:
- https://web.archive.org/web/2023/https://developer.twitter.com/en/support/twitter-api/error-troubleshooting
- https://web.archive.org/web/2024/https://developer.twitter.com/en/docs/twitter-api/rate-limits
- https://devcommunity.x.com/t/cannot-add-member-to-list-i-created-code-104/25373
- https://github.com/trevorhobenshield/twitter-api-client/blob/master/twitter/account.py (rate_limits 64)

---

## CLAIM 5 — queryIds & feature sets DRIFT; all 5 ids changed since 2023 snapshot → CONFIRMED

Old ids from twitter-api-client `twitter/constants.py` vs live fa0311 ids:
| Op | OLD (2023) | NEW (live) | changed? |
|---|---|---|---|
| ListAddMember | `P8tyfv2_0HzofrB5f6_ugw` | `vWPi0CTMoPFsjsL6W4IynQ` | YES |
| ListRemoveMember | `DBZowzFN492FFkBPBptCwg` | `cAGvZIu7SW0YlLYynz3VYA` | YES |
| UserByScreenName | `sLVLhk0bGj3MVFEKTdax1w` | `IGgvgiOx4QZndDHuD3x9TQ` | YES |
| ListsManagementPageTimeline | `nhYp4n09Hi5n2hQWseQztg` | `HudcGxZ51woVeGbC1KKazA` | YES |
| ListOwnerships | `wQcOSjSQ8NtgxIwvYl1lMg` | `oO9-b3v7B59YGCQ-0vSkmg` | YES |

All 5 changed. The 3 explicit before→after pairs in the synthesis (ListAddMember, UserByScreenName,
ListOwnerships) are each exactly correct.

Discovery pipeline CONFIRMED in fa0311 source:
- `lib/twitter.py:get_script_url` (84): regex `https://abs\.twimg\.com/{client}/client-web/[a-zA-Z0-9.]*?\.js`
  with CLIENT="responsive-web" → matches "fetch x.com/home, regex abs.twimg.com/responsive-web/client-web/*.js"
- `lib/graphql.py:get_graphql / marge_exports / to_api`: brace-parse bundle for
  {queryId, operationName, operationType, metadata.featureSwitches}, zip featureSwitches names with frozen
  feature-value config (FreezeObject) → exactly the claim's mechanism.

Runtime "sniff the app's own /i/api/graphql/<id>/<OpName> requests in MAIN world and replay" strategy is
sound engineering advice (not a doc claim); MAIN-vs-ISOLATED world distinction is real per Chrome docs.

Source URLs:
- https://github.com/trevorhobenshield/twitter-api-client/blob/master/twitter/constants.py (old ids)
- https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/lib/twitter.py (get_script_url 83-84)
- https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/lib/graphql.py (get_graphql/marge_exports/to_api)
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts (isolated_world section)

---

## CLAIM 6 — DOM flow with real selectors → PARTIALLY CONFIRMED (caret + confirm + menuitem solid; inner dialog testids UNVERIFIED)

CONFIRMED from lucahammer gist (raw):
- Caret alias: `[data-testid="tweet"] [aria-label="More"][data-testid="caret"]` — VERBATIM present.
- Menu item: `[role="menuitem"]` — present (via waitForElemToExist).
- Confirmation: `[data-testid="confirmationSheetConfirm"]` — VERBATIM present.
- waitForElemToExist (MutationObserver/poll-between-steps pattern) — present.

CONFIRMED label string from TwidereX (cited): `Common.Controls.User.Actions.AddRemoveFromLists` =
"Add/remove from Lists" (en.lproj/Localizable.strings). NOTE: TwidereX is a NATIVE iOS app — this proves
the menu *exists conceptually / its canonical label*, NOT that the WEB DOM exposes that exact menuitem
text. The web app's text is "Add/remove @user from Lists"; matching via /add\/remove .* from lists/i is a
reasonable regex but is not directly evidenced by a primary web-DOM source in this pass.

NOT VERIFIED (synthesis itself flags these as least stable, correctly):
- `[data-testid="Dropdown"]` container — NOT found in the gist.
- list rows as role=button/checkbox carrying `aria-checked` for idempotency — NOT found in any fetched
  primary source. This is the weakest, most-likely-to-break part. Keep the role/text fallback advice.

Chrome content-scripts doc (cited) CONFIRMED: isolated world is default; MAIN world opt-in; content scripts
can read/modify page DOM. Section id `isolated_world` present.

Source URLs:
- https://gist.github.com/lucahammer/1aa16b4d3c1fb04035839da5ef699d65 (raw verified)
- https://github.com/TwidereProject/TwidereX-iOS (TwidereSDK/.../Localizable.strings AddRemoveFromLists)
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

---

## CLAIM 7 — DOM = conservative default; GraphQL = opt-in higher-risk fast path → CONFIRMED (reasoning sound)

- X automation policy page is real and developer-oriented (Wayback help.x.com/en/rules-and-policies/x-automation,
  "Automation rules", "You are ultimately responsible for the actions taken with your account"). The policy
  framing (human-paced, no mass automation) is consistent with the page's intent. NOTE: help.x.com is behind
  Cloudflare JS challenge for direct curl; verified via Wayback. Could not pull the exact "1 click = 1 add"
  phrasing from the official page (that is the synthesis's own engineering invariant, not a quoted rule).
- "Internal GraphQL hits private/undocumented endpoints outside the official API program and risks anti-bot
  enforcement": STRONGLY corroborated by github/dmca 2026-03-27-x-corp.md — X Corp actively DMCA-takes-down
  reverse-engineering of exactly these mechanisms (GraphQL query scraping, client API keys, login flow,
  x-client-transaction-id). This is hard primary evidence that the GraphQL path carries real ToS/enforcement
  risk, strengthening the synthesis's risk ranking.
- docs.x.com/x-api/lists/add-list-member exists as the SANCTIONED alternative (official v2 endpoint) — could
  not fetch body (JS SPA) but the path/endpoint is real.
- The "code-104 thread documents lockouts" sub-claim is again unsupported (see Claim 4).

Net: the POLICY POSITIONING is sound and well-supported. One sourcing fix (the 104-lockout attribution) and
the note that some "rules" phrasing is the authors' invariant rather than quoted policy.

Source URLs:
- https://web.archive.org/web/2024/https://help.x.com/en/rules-and-policies/x-automation
- https://help.x.com/en/rules-and-policies/platform-manipulation
- https://docs.x.com/x-api/lists/add-list-member
- https://github.com/github/dmca/blob/master/2026/03/2026-03-27-x-corp.md
- https://devcommunity.x.com/t/cannot-add-member-to-list-i-created-code-104/25373

---

## CORRECTIONS the synthesis must apply
1. Claim 3 citation: the trekhleb.dev home-timeline blog does NOT mention x-client-transaction-id or any
   header. Replace with mikf/gallery-dl, ainergiz/xfeed docs, iSarabjitDhiman/XClientTransaction, and the
   github/dmca X-corp takedown. (Requirement is real; the cited source is wrong.)
2. Claim 2 wording: the reference lib passes {listId,userId} as INTEGERS, not strings. Reword to "id values
   (the web app serializes them as JSON strings)". And mark the success-shape {data:{list:{...}}} as not
   independently re-verified (uncertain sub-detail).
3. Claims 4 & 7: remove the assertion that the devcommunity code-104 thread "documents lockouts/soft-locks
   after rapid list edits" — the thread covers only ownership/cap/block causes. Account-lockout risk is a
   general anti-bot concern, better sourced to the github/dmca takedown + platform-manipulation policy.
4. Claim 4: code 353=CSRF and code 104 are community/SDK-sourced, not in the official v1.1 error table — keep
   at medium confidence. Codes 88 + 429 + x-rate-limit-* ARE official (high confidence).
5. Claim 6: `[data-testid="Dropdown"]`, list-row `aria-checked`/checkbox roles are NOT primary-source
   verified — keep flagged as least-stable with role/text fallbacks (synthesis already does this).
6. General: mark all queryIds/feature-sets as point-in-time; the only durable strategy is runtime sniffing
   (MAIN world) — never hardcode. (Synthesis already says this.)
