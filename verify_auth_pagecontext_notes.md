# Adversarial Verification — Auth & Page-Context Credentials (X/Twitter MV3 extension)

Date: 2026-06-07. Verifier ran `curl -sSL` on primary docs, `gh` GitHub code search, cloned-file inspection. `mgrep --web` quota was exhausted (HTTP 429) so web discovery fell back to GitHub code search of mature reverse-engineering projects (gallery-dl, twscrape, nitter, OldTwitter) — these are *primary* implementations and are stronger than blog posts for header-level facts.

Bottom line: 7 of 9 claims CONFIRMED, 2 CONFIRMED-with-correction. The two corrections both concern **citations that do not actually support the asserted fact** (the X help page does not document `ct0`/HttpOnly; the trekhleb blog does not contain the logged-in header set). The underlying technical facts are nonetheless true and independently corroborated.

---

## CLAIM 1 — MV3 content-script fetch runs in PAGE context; same-origin x.com request auto-attaches session cookies. CONFIRMED

Primary evidence (MDN Content scripts, verbatim):
- "In Chrome and Firefox in Manifest V3, these requests happen in context of the page, so they are made to a relative URL. For example, /api is sent to https://«current page URL»/api."
- "In Chrome, starting with version 73, and Firefox, starting with version 101 when using Manifest V3, content scripts are subject to the same CORS policy as the page they are running within. Only backend scripts have elevated cross-domain privileges."

MDN Request.credentials (verbatim):
- `same-origin`: "Only send and include credentials for same-origin requests. This is the default."
- `include`: "Always include credentials, even for cross-origin requests."
- "const request = new Request(\"flowers.jpg\"); ... // returns \"same-origin\" by default"

Same scheme/host/port (https / x.com / 443) => same-origin => default `same-origin` credentials mode sends cookies (incl. HttpOnly auth_token + ct0); same-origin = no CORS preflight. You cannot set the `Cookie` header from JS (forbidden header name) and need not — the browser attaches it. All correct.

CAVEAT (does not refute, but synthesis should be aware): MDN also notes the privileged content-script fetch instances have "the side effect of not setting the Origin and Referer headers like a request from the page itself would." This concerns Origin/Referer, not Cookie, and only the cross-origin CORS path. For a plain same-origin `fetch('/i/api/graphql/...')` issued from an x.com tab content script, cookies attach by default. Recommend explicitly setting `credentials: 'same-origin'` (or `'include'`) and `Referer`/headers via the page's own code path to fully mimic the site; the bare claim is still correct.

Sources:
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
- https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials

---

## CLAIM 2 — ct0 readable from document.cookie in ISOLATED-world content script; no cookies API / host_permissions for it. CONFIRMED (with citation correction)

Mechanism confirmed by a real X browser extension (OldTwitter, dimdenGD), `scripts/config.js`:
```js
get csrf() {
    let csrf = document.cookie.match(/(?:^|;\s*)ct0=([0-9a-f]+)\s*(?:;|$)/);
    return csrf ? csrf[1] : "";
}
```
=> ct0 IS readable from `document.cookie` (so it is NOT HttpOnly), and is consumed as the CSRF token. The isolated world shares the page DOM/`document.cookie` per Chrome docs ("they share access to the page's DOM").

ct0-as-CSRF double-submit confirmed by gallery-dl/twscrape/nitter (see Claim 5): the ct0 cookie value is copied verbatim into the `x-csrf-token` header.

Content-script injection without separate host_permissions: Chrome docs show a static `content_scripts` entry uses a `matches` array; MDN: "On installation, an extension can request host permissions for hosts in its matches lists of the content_scripts manifest key." So declaring `matches` grants injection (host permission is requested for those match patterns at install; no extra `host_permissions` block is strictly required for injection on the matched origin). Correct.

CORRECTION (citation): The cited X help page `https://help.x.com/en/rules-and-policies/x-cookies` does **NOT** support the ct0/CSRF/HttpOnly specifics. The live page is Cloudflare-gated ("Just a moment... Enable JavaScript"); the rendered/archived version (web.archive.org snapshot 20260606151043) describes only high-level cookie *categories* ("Authentication and security, Functionality, ...") and contains **no mention of `ct0`, `csrf`, `httponly`, or `auth_token`**. The HttpOnly/CSRF fact is true but is corroborated by implementations (OldTwitter, gallery-dl), not by that X help URL. Synthesis should drop/replace that citation with an implementation source.

auth_token HttpOnly+Secure and not JS-readable: consistent with everything observed (extensions read ct0 via document.cookie but never auth_token that way; auth_token only appears where a cookie *jar* is supplied, e.g. gallery-dl `cookies.get("auth_token")`). And it is never needed for a same-origin request — correct.

Sources:
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://github.com/dimdenGD/OldTwitter/blob/master/scripts/config.js (document.cookie ct0 read)
- CORRECTION: drop https://help.x.com/en/rules-and-policies/x-cookies as support for the ct0/HttpOnly claim (does not mention it; JS/Cloudflare-gated)

---

## CLAIM 3 — chrome.cookies is a service-worker capability needing `cookies` + host_permissions; unnecessary here. CONFIRMED

Chrome cookies API doc (verbatim):
- "To use the cookies API, declare the \"cookies\" permission in your manifest along with host permissions for any hosts whose cookies you want to access." (example shows `host_permissions: ["*://*.google.com/"]` + `permissions: ["cookies"]`).
- Cookie object exposes `httpOnly` field: "True if the cookie is marked as HttpOnly (i.e. the cookie is inaccessible to client-side scripts)." => chrome.cookies CAN read auth_token's value.
- "If host permissions for this URL are not specified in the manifest file, the API call will fail." (get/set)

So chrome.cookies needs both `cookies` permission and host_permissions, exposes httpOnly cookies, and is not available in content scripts (it is a privileged extension API used from the SW/background; content scripts access only a subset of WebExtension APIs per MDN). Reading auth_token gains nothing because the browser already sends it on the same-origin request. Using chrome.cookies adds a scarier permission warning + message plumbing. All correct.

Source:
- https://developer.chrome.com/docs/extensions/reference/api/cookies

---

## CLAIM 4 — Web app bearer is a static, public, hard-coded client constant. CONFIRMED

Exact value `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA` is byte-identical across three independent primary sources (verified equal by string compare):
- fa0311 API.json `header.authorization`
- gallery-dl `gallery_dl/extractor/twitter.py` (split across 3 string literals, lines 1357-1359)
- OldTwitter `scripts/config.js` where it is literally named **`public_token`** (line 4)

OldTwitter naming (`public_token` vs a separate `oauth_key` bearer for legacy 1.1) is direct evidence it is a *public* constant, same for all web visitors, not a per-user secret. Per-user auth is the cookies. X can rotate it (OldTwitter ships two different bearers historically), so MAIN-world bundle-scraping for rotation-resilience is a valid fallback. Correct. `%3D` is URL-encoded `=` — correct.

Sources:
- https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/API.json
- https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/twitter.py
- https://github.com/dimdenGD/OldTwitter/blob/master/scripts/config.js (labels it `public_token`)

---

## CLAIM 5 — Exact logged-in header set; x-twitter-auth-type:OAuth2Session present only when logged in; Cookie auto-attached. CONFIRMED (with citation correction)

GitHub code search: `"x-twitter-auth-type" OAuth2Session` => 1828 results. Definitive in mature projects:

gallery-dl `twitter.py` (lines 1344-1360):
```python
csrf_token = cookies.get("ct0", ...)          # double-submit source
auth_token = cookies.get("auth_token", ...)
self.headers = {
  "content-type": "application/json",
  "x-guest-token": None,
  "x-twitter-auth-type": "OAuth2Session" if auth_token else None,   # ONLY when logged in
  "x-csrf-token": csrf_token,                                       # == ct0
  "x-twitter-client-language": "en",
  "x-twitter-active-user": "yes",
  "x-client-transaction-id": None,
  "authorization": "Bearer AAAA...CpTnA",
}
```
twscrape `login.py` (214-217, 272-274): `x-csrf-token = ct0`, `x-twitter-auth-type = "OAuth2Session"`.
nitter `tools/create_session_curl.py` (216-218): `X-Twitter-Auth-Type = "OAuth2Session"`, `X-Csrf-Token = cookies['ct0']`.

=> Every element of the asserted logged-in header set confirmed: authorization Bearer, x-csrf-token=ct0 (double-submit), x-twitter-auth-type:OAuth2Session (present iff auth_token/logged-in), x-twitter-active-user:yes, x-twitter-client-language, content-type. Cookie auto-attached on same-origin (Claim 1). Endpoint shape `GET /i/api/graphql/<queryId>/<Op>?variables=<json>&features=<json>` matches sample.py (which builds url `.../graphql/oPHs3ydu7ZOOy2f02soaPA/UserTweets` with params queryId/variables/features).

Guest variant in fa0311 sample.py confirmed verbatim: `x-guest-token`, `x-csrf-token = session.cookies.get("ct0")`, `x-twitter-active-user: "yes"`, `x-twitter-client-language: "en"` — and it does NOT set x-twitter-auth-type. So the logged-in case swapping x-guest-token for x-twitter-auth-type:OAuth2Session is exactly right.

CORRECTION (citation): The cited `https://trekhleb.dev/blog/2024/api-design-x-home-timeline/` does NOT contain the logged-in header strings — keyword scan: `x-twitter-auth-type`=absent, `oauth2session`=absent, `x-csrf`=absent, `bearer`=absent. It DOES corroborate the endpoint shape (graphql / features / queryId all present). So cite trekhleb only for the GraphQL endpoint/queryId/features structure, and cite gallery-dl/twscrape/nitter (the actual code) for the header set. fa0311 sample.py is correctly cited for the guest variant.

Sources:
- https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/twitter.py (logged-in header set + auth_token gating)
- https://github.com/vladkens/twscrape/blob/main/twscrape/login.py
- https://github.com/zedeus/nitter/blob/master/tools/create_session_curl.py
- https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/sample.py (guest variant + endpoint shape)
- trekhleb (endpoint shape ONLY): https://trekhleb.dev/blog/2024/api-design-x-home-timeline/

---

## CLAIM 6 — MAIN world is the only way to read page JS state/bundle; runs under page CSP, no chrome.* APIs; bridge via postMessage. CONFIRMED

Chrome scripting API doc — ExecutionWorld (verbatim):
- "ExecutionWorld — Chrome 95+ — The JavaScript world for a script to execute within."
- `"ISOLATED"` = "the execution environment unique to this extension."
- `"MAIN"` = "the main world of the DOM, which is the execution environment shared with the host page's JavaScript."
- `world` field "Defaults to ISOLATED" (appears for executeScript/registerContentScripts; Chrome 95+/102+).

Chrome content-scripts doc (verbatim):
- "An isolated world is a private execution environment that isn't accessible to the page... JavaScript variables in an extension's content scripts are not visible to the host page" => to read the page's React/webpack JS variables (bearer/queryIds/features) you must run in MAIN.
- CSP: isolated world has the extension CSP; "When a content script is injected into the main world, the CSP of the page applies." => MAIN runs under page CSP.
- Communication is via the shared DOM / window messaging (postMessage) since worlds are isolated.

chrome.* not available in MAIN: content scripts in general "can access a small subset of the WebExtension APIs" (MDN); MAIN world is the page's own JS environment, so to use chrome.* you message back to the isolated content script / SW. Bridge via postMessage is the documented pattern. All correct.

Sources:
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

---

## CLAIM 7 — x-client-transaction-id is an increasingly-required per-request anti-bot header; main breakage source; best to let MAIN-world page code produce it. CONFIRMED (confidence medium, appropriately)

- Present as a per-request header slot in gallery-dl (`"x-client-transaction-id": None` then set per call): `_transaction_id(self, url, method)` -> `generate_transaction_id(method, path)` (lines 1885-1891). Confirms: computed client-side, per method+path, NOT hard-codeable.
- greasyfork script 536593 description (verbatim): "JS code to generate required X-Client-Transaction-ID Header for X API requests" — confirms it is described as *required*.
- iSarabjitDhiman/XClientTransaction repo EXISTS: "Twitter X-Client-Transaction-Id generator written in python", 237 stars, updated 2026-05-27 — confirms a maintained Python port exists.
- antibot.blog/posts/1741552025433: page is a JS SPA; curl rendered title "Twitter Header: Part 1, Deobfuscation" — corroborates a deobfuscation writeup exists (body not server-rendered; treat as supporting, not quotable).

"increasingly-required" / "main thing that breaks hand-rolled calls" is a reasonable characterization (medium confidence is right — it is implementation/community-derived, not vendor-documented). Computed from page-embedded verification key material + method + path + time via obfuscated bundle: matches the gallery-dl approach and community ports. Letting the page's own MAIN-world code produce it is the most robust mitigation — consistent with the architecture. Confirmed at the stated medium confidence.

Sources:
- https://github.com/iSarabjitDhiman/XClientTransaction (exists, maintained)
- https://greasyfork.org/en/scripts/536593-generate-x-client-transaction-id ("required X-Client-Transaction-ID Header")
- https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/twitter.py (per-request generation)
- https://antibot.blog/posts/1741552025433 (deobfuscation writeup; JS-rendered)

---

## CLAIM 8 — X ToS bans access outside published interfaces + scraping/crawling w/o written consent; private GraphQL not a published interface; dev policy redistribution + keep-credentials-private. CONFIRMED

X ToS 2025-05-08 PDF (verbatim, extracted via pypdf):
- "...currently available, published interfaces that we provide. For example, this means that you cannot scrape the Services without X's express written permission, try to work around any technical limitations we impose, or otherwise attempt to disrupt the operation of the [Services]..."
- "(NOTE: crawling or scraping the Services in any form, for any purpose without our prior written consent is expressly prohibited)"

X Developer Policy (docs.x.com, verbatim):
- "...you may not distribute more than 1,500,000 Post IDs to any entity ... within any 30 day period unless you have received written permission from X." (matches the <=1.5M / entity / 30d claim)
- "You must keep all API keys or other access credentials private."

TechCrunch (2023-09-08) confirms the ban context and quotes "NOTE: crawling or scraping the Services in any form, for any purpose without our prior written consent is expressly..." Correct secondary corroboration.

The private GraphQL endpoint (/i/api/graphql/...) is not in the "currently available, published interfaces" (those are the website UI and the official paid X API). Risk framing (account lock/suspension, store removal, breakage) and the lower-risk-but-not-curative framing (own session/own data/on-page/no redistribution) are accurate; production-compliant path = official paid X API. All correct.

Sources:
- https://cdn.cms-twdigitalassets.com/content/dam/legal-twitter/site-assets/terms-of-service-2025-05-08/en/x-terms-of-service-2025-05-08.pdf
- https://docs.x.com/developer-terms/policy
- https://techcrunch.com/2023/09/08/x-updates-its-terms-to-ban-crawling-and-scraping/

---

## CLAIM 9 — High-maintenance by design: queryId/doc_id rotation, features churn, guest-token changes, transaction-id enforcement. CONFIRMED (confidence medium; one scope note)

webparsers.com article (verbatim timeline):
- "November 2023: GraphQL endpoint changes required doc_id updates across all query types"
- "January 2024: Guest token format and expiration timing changed; TLS fingerprinting detection tightened"
- "April 2024: doc_ids rotated again; anti-scraping headers added to responses"
- "July 2024: Cookie validation requirements changed; session handling became more strict"
- "...rolling out defensive changes every 2-4 weeks that break DIY scrapers. Guest tokens expire, doc_ids rotate, and rate limits shift... 10-15 hours of monthly maintenance."

=> doc_id rotation (Nov 2023, Apr 2024), guest-token format changes (Jan 2024), cookie-validation tightening (Jul 2024), and the every-2-4-weeks cadence are all confirmed in the cited source.

SCOPE NOTE (minor): the webparsers article does NOT explicitly attribute breakage to "transaction-id enforcement" (word "transaction" absent from that page). The transaction-id enforcement point is supported instead by Claim 7's sources (greasyfork/XClientTransaction/gallery-dl). Also note webparsers is a commercial scraping vendor (mild incentive to over-state breakage) — medium confidence is appropriate. queryId/features churn is also broadly corroborated by fa0311/gallery-dl carrying per-operation queryId + features objects that must be kept current. Confirmed at medium.

Source:
- https://webparsers.com/how-to-scrape-x-com-twitter-in-2026/

---

## CORRECTIONS the synthesis MUST apply
1. Claim 2: The X help page (help.x.com/.../x-cookies) does NOT document ct0/CSRF/HttpOnly — it lists only generic cookie categories and is JS/Cloudflare-gated. Replace that citation with an implementation source (OldTwitter scripts/config.js reads `ct0` from `document.cookie`; gallery-dl/twscrape map ct0->x-csrf-token). The technical fact (ct0 not HttpOnly, JS-readable) remains TRUE.
2. Claim 5: The trekhleb blog does NOT contain the logged-in header set (no x-twitter-auth-type/OAuth2Session/x-csrf/bearer strings). Cite trekhleb only for the GraphQL endpoint/queryId/features structure; cite gallery-dl/twscrape/nitter for the header set.
3. Claim 1 (nuance, not a refutation): MV3 privileged content-script fetch omits Origin/Referer on the CORS path. For full site fidelity, set credentials explicitly and consider issuing the request through the page's MAIN-world code path. Cookies still auto-attach on same-origin.
4. Claim 9 (scope): the webparsers source supports doc_id/guest-token/cookie-validation rotation + 2-4 week cadence, but NOT "transaction-id enforcement" specifically — that sub-point leans on Claim 7's sources. webparsers is a commercial vendor; keep at medium confidence.
5. Tooling note: `mgrep --web` was unavailable (429 monthly-quota). Web corroboration was obtained via GitHub code search (`gh api search/code`) over mature primary implementations, which is stronger than blogs for header facts.
