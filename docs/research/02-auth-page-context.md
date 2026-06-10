# Auth in Page Context: Getting `ct0` + Bearer for x.com Self-Calls from an MV3 Content Script

**Scope.** An MV3 extension whose content script runs on `x.com` needs to call x.com's own
private GraphQL endpoints (`https://x.com/i/api/graphql/...`) **as the already-logged-in user**.
This requires two credentials the web app uses:

1. **`ct0`** — the CSRF token cookie, echoed back as the `x-csrf-token` header (double-submit-cookie pattern).
2. The **authorization bearer token** — the long static `Bearer AAAAAAAA...` string the web client hard-codes.

This note compares every credible way to obtain them, recommends the simplest reliable one, explains
*why* a same-origin content-script `fetch` carries the session, documents the exact header set the web
app sends, and flags the policy/ToS situation.

---

## TL;DR / Recommendation

**Do the whole thing from an ISOLATED-world content script running on `*://x.com/*`, with a same-origin
`fetch(..., { credentials: 'include' })`. You do not need the `chrome.cookies` API, you do not need
`host_permissions`, and you do not need MAIN-world injection for the cookie.**

- **`ct0`:** read it from `document.cookie` in the ISOLATED-world content script. `ct0` is **not**
  `HttpOnly`, so client-side JS (page or content script) can read it. (The sensitive session cookie
  `auth_token` *is* `HttpOnly` and you can't read it — but you don't need to, because you never set
  the `Cookie` header yourself; the browser attaches it automatically on the same-origin request.)
- **Bearer token:** in practice, hard-code the well-known public web bearer constant (it is a static,
  non-secret client identifier shipped in the web bundle, not a per-user secret). If you want to be
  robust against rotation, scrape it from the loaded JS bundle via MAIN-world (see §4), but that is
  optional and adds fragility.
- **The request itself:** issue it from the content script as a **same-origin** request to
  `https://x.com/i/api/graphql/...`. Because the page origin *is* `x.com`, the browser treats it as
  same-origin and `credentials: 'include'` (or even the default `same-origin`) attaches the
  `auth_token` + `ct0` cookies. You then add `authorization`, `x-csrf-token: <ct0>`,
  `x-twitter-active-user: yes`, `x-twitter-auth-type: OAuth2Session`, `content-type` headers yourself.

This is the same code path the web app uses, so the backend can't distinguish it on credentials alone.
(It *can* increasingly distinguish it via `x-client-transaction-id` — see §6.)

> Policy caveat up front: x.com's Terms of Service prohibit accessing the service other than through
> published interfaces and prohibit "crawling or scraping the Services in any form, for any purpose
> without our prior written consent." Calling the private GraphQL API from an extension is in tension
> with this regardless of how clean the technique is. See §7.

---

## 1. The two credentials, precisely

### 1.1 `ct0` (CSRF cookie)
- A cookie on the `.x.com` domain whose value is echoed into the `x-csrf-token` request header.
  This is the classic **double-submit cookie** CSRF defense: the server checks that the header value
  equals the cookie value, which only same-origin JS that can read the cookie can do.
- **`ct0` is not flagged `HttpOnly`** — by design, because the web app's own JS must read it to set
  `x-csrf-token`. Therefore `document.cookie` exposes it to client-side script. (Source: X cookie
  help page; double-submit pattern is the standard reason a CSRF cookie is readable.)
- Contrast: **`auth_token`** (the actual session) is `HttpOnly` + `Secure` and is **not** readable
  from `document.cookie`. You never read it; the browser sends it for you on same-origin requests.

### 1.2 Authorization bearer token
- The web client uses a **static, hard-coded** bearer string of the form `Bearer AAAAAAAAAAAA...`.
  It is a public *client* credential baked into the JS bundle, identical for every anonymous and
  logged-in web visitor — it is **not** a per-user secret. The per-user authentication is carried by
  the cookies (`auth_token` + `ct0`), not the bearer.
- The canonical web bearer observed in reverse-engineering corpora (fa0311/TwitterInternalAPIDocument
  `API.json` header block):
  ```
  Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA
  ```
  (Note the `%3D` is a URL-encoded `=`. This value is widely published and has been stable for years,
  but X *can* rotate it; treat it as "stable but not guaranteed".)

---

## 2. Why a content-script same-origin `fetch` sends the session cookies

This is the crux and the reason the whole approach works without any cookie API.

1. **The content script's `fetch`/XHR runs in the network context of the page.** Per MDN's content
   scripts reference: in **Chrome and Firefox under Manifest V3, content-script requests happen in the
   context of the page**, so a relative URL like `/i/api/...` resolves against the current page URL,
   and the request's origin is the page's origin. The script is injected into an `x.com` tab, so the
   request origin is `https://x.com`.
2. **`https://x.com/i/api/graphql/...` is therefore same-origin.** Same scheme (`https`), same host
   (`x.com`), same port. No CORS preflight is needed for a same-origin request, and the browser is
   free to attach cookies.
3. **`credentials` controls cookie attachment.** Per MDN `Request.credentials`:
   - `omit` — never send cookies.
   - `same-origin` (**the default**) — send cookies *for same-origin requests*.
   - `include` — always send, even cross-origin.
   Because the request is same-origin, **the default already sends cookies**; `credentials: 'include'`
   is belt-and-suspenders and also future-proofs you if the request ever becomes cross-origin
   (e.g. `api.x.com`). The browser attaches **all** non-expired cookies whose domain/path/SameSite
   rules match — including the `HttpOnly` `auth_token` and the readable `ct0` — automatically. You
   never construct a `Cookie` header (you can't set it from `fetch` anyway; it's a forbidden header).
4. **SameSite is satisfied.** X's session cookies are first-party to `x.com`; a request *from* an
   `x.com` page *to* `x.com` is same-site, so even `SameSite=Lax`/`Strict` cookies are sent.
5. **MV3 content-script CORS note:** Under MV3, content scripts are subject to the **same CORS policy
   as the host page** (Chrome 73+), and `host_permissions` do **not** grant content scripts elevated
   cross-origin fetch power (only extension pages / the service worker get that). This is *irrelevant
   here* precisely because our request is same-origin — there is no cross-origin barrier to cross.

**Net:** the only thing you must supply by hand are the *header-form* credentials (`authorization`,
`x-csrf-token`), plus the marker headers. The actual session (`auth_token`) rides along invisibly via
the cookie jar.

---

## 3. Approach comparison

| Approach | Gets `ct0`? | Gets bearer? | Permissions needed | Reliability | Verdict |
|---|---|---|---|---|---|
| **A. ISOLATED-world content script: `document.cookie` + same-origin `fetch`** | Yes (ct0 not HttpOnly) | hard-code constant | `content_scripts` match `*://x.com/*` only. **No `cookies`, no `host_permissions`.** | High; mirrors the web app exactly | **RECOMMENDED** |
| **B. `chrome.cookies` API from the service worker** | Yes (can even read HttpOnly cookies) | no (separate problem) | `"permissions": ["cookies"]` **+** `"host_permissions": ["*://x.com/*"]` (or `https://x.com/`) | High, but heavier manifest + cross-context plumbing | Overkill for ct0; useful only if you need `auth_token` value itself (you don't) |
| **C. MAIN-world injection to read page state / bundle** | indirectly | **yes** — read the bearer/feature flags from app state or bundle | `world: "MAIN"` content script or `chrome.scripting` with `world:'MAIN'` | Medium; brittle to bundle changes | Use **only** to harvest the bearer/feature flags if you refuse to hard-code |
| **D. Capture bearer via `webRequest`/DNR header inspection** | n/a | yes | `webRequest` (read-only in MV3) + host perms | Medium; needs an in-flight request to observe | Niche; more moving parts than C |

### 3.A — ISOLATED content script (recommended)
The content script lives in an **isolated world**: a private JS execution environment that shares the
page's DOM but not its JS variables (Chrome content-scripts doc). Critically, **`document.cookie` is a
DOM/property accessor, and the isolated world shares the DOM**, so the content script reads the *page's*
non-HttpOnly cookies directly. No messaging, no API.

```js
// content.js  — manifest: { "content_scripts":[{"matches":["*://x.com/*"],"js":["content.js"]}] }
function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

const ct0 = getCookie('ct0');
const BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const res = await fetch(
  'https://x.com/i/api/graphql/<queryId>/<OperationName>?variables=' +
    encodeURIComponent(JSON.stringify(variables)) +
    '&features=' + encodeURIComponent(JSON.stringify(features)),
  {
    method: 'GET',
    credentials: 'include',          // same-origin default would also work
    headers: {
      'authorization': BEARER,
      'x-csrf-token': ct0,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en',
      'content-type': 'application/json',
      // 'x-client-transaction-id': <computed>,  // see §6 — increasingly required
    },
  }
);
const data = await res.json();
```
Why this is the minimal-permission path: a **declared content script does not require
`host_permissions`** — the `matches` pattern in `content_scripts` is what grants injection. And because
the fetch is same-origin from the page context, no cross-origin permission is involved.

### 3.B — `chrome.cookies` from the service worker
- The `chrome.cookies` API is **not available in content scripts**; it must be called from an
  extension context with access to it — i.e. the **service worker** (MV3 background) or an extension
  page. (Historic SO: "chrome.cookies undefined in a content script".)
- Manifest requirement (Chrome cookies API doc): declare **`"permissions": ["cookies"]`** *and*
  **`host_permissions`** for the hosts whose cookies you want, e.g.:
  ```json
  { "permissions": ["cookies"], "host_permissions": ["https://x.com/"] }
  ```
  The `url` argument to `cookies.get/getAll` must be covered by host permissions or the call fails.
- It **can** read `HttpOnly` cookies (the `Cookie.httpOnly` field is exposed), so it's the only way to
  read `auth_token`'s *value*. But you don't need that value — you'd just be reconstructing what the
  browser already sends automatically. So this buys you nothing for `ct0` and adds a permission that
  triggers a scarier install-time permission warning ("Read and change your data" + cookie access).
- Cross-context cost: SW reads cookie → message-passes to content script (or the content script
  `chrome.runtime.sendMessage`s a request to the SW which does the whole fetch). More plumbing.

### 3.C — MAIN-world injection (only for the bearer / feature flags)
- The page's own JS (React app + webpack bundle) lives in the **MAIN world**, isolated from your
  content script. To read the page's JS variables / module state (e.g. the bearer constant or the
  current GraphQL `queryId`s and `features` flag objects baked into the bundle), you must execute *in
  the MAIN world*.
- Two ways: a static content script with **`"world": "MAIN"`**, or `chrome.scripting.executeScript({
  target, world: 'MAIN', func })` (the `ExecutionWorld` enum, `MAIN`/`ISOLATED`, Chrome 95+; `world`
  defaults to `ISOLATED`).
- MAIN-world code runs under the **page's CSP**, not the extension CSP, and has **no `chrome.*` APIs** —
  bridge results back to the isolated world via `window.postMessage` / a DOM CustomEvent.
- Use this **only** if you decline to hard-code the bearer and want to extract whatever the live bundle
  is using. It is the most fragile part of any X integration because the bundle is minified and
  reshaped frequently. Hard-coding the well-known constant is simpler and, empirically, stable.

### 3.D — Capturing the bearer from traffic
- MV3 `webRequest` is observe-only (no blocking), but `onBeforeSendHeaders` can read the
  `authorization` header off a real in-flight request and cache it. Needs `webRequest` permission +
  host perms, and you must wait for the app to make a request. More moving parts than C and no
  upside over hard-coding for a value that is the same for everyone.

---

## 4. The exact request the web app sends

Endpoint shape (read operations are typically `GET`; mutations `POST`):
```
GET https://x.com/i/api/graphql/<queryId>/<OperationName>?variables=<urlencoded-json>&features=<urlencoded-json>
```
- `<queryId>` — opaque per-operation persisted-query id (a.k.a. `doc_id`); these **rotate** with
  client releases.
- `variables` — operation inputs (e.g. `{ "userId": "...", "count": 40, ... }`), URL-encoded JSON.
- `features` — a large object of boolean feature flags the client must send or the server 400s.

### Exact request headers (logged-in web client)
| Header | Value / form | Notes |
|---|---|---|
| `authorization` | `Bearer AAAAAAAA…` | static public web bearer (see §1.2) |
| `x-csrf-token` | `<ct0>` | **must equal** the `ct0` cookie (double-submit CSRF) |
| `x-twitter-auth-type` | `OAuth2Session` | present **only when logged in** (cookie session). Absent for guest-token calls |
| `x-twitter-active-user` | `yes` | marks an interactive user; affects rate-limit buckets |
| `x-twitter-client-language` | e.g. `en` | UI language |
| `content-type` | `application/json` | sent on POST/mutations; commonly present on GETs too |
| `x-client-transaction-id` | computed per-request | **anti-bot**, increasingly enforced — see §6 |
| `Cookie` | `auth_token=…; ct0=…; …` | **NOT set by you** — browser attaches it automatically on the same-origin request |
| `referer` / `origin` | `https://x.com/` / `https://x.com` | a page-context fetch sets these naturally |

(For the *guest* — not logged-in — variant the client instead sends `x-guest-token: <token>` and omits
`x-twitter-auth-type`. The fa0311 sample.py demonstrates exactly this guest header set:
`x-guest-token`, `x-csrf-token` = `ct0`, `x-twitter-active-user: yes`, `x-twitter-client-language`.
Our logged-in case swaps `x-guest-token` for `x-twitter-auth-type: OAuth2Session` and relies on the
session cookies.)

### Minimal viable header set for a logged-in self-call
`authorization`, `x-csrf-token`, `x-twitter-auth-type: OAuth2Session`, `x-twitter-active-user: yes`,
`content-type`, plus (increasingly) `x-client-transaction-id`. The cookies come for free.

---

## 5. Isolation model recap (so the design is unambiguous)
- **Isolated world** (your default content script): shares the DOM (so `document.cookie`, DOM events,
  and a page-context `fetch` all work) but **not** the page's JS variables. Has access to a subset of
  `chrome.*` (messaging, storage). Runs under the **extension** CSP.
- **MAIN world**: the page's own JS realm. Sees the app's variables/modules; runs under the **page**
  CSP; **no `chrome.*`**.
- **Service worker** (MV3 background): the only place with the privileged extension fetch + full
  `chrome.*` incl. `chrome.cookies`. No DOM, no `document`.

Mapping to the task: `ct0` lives in the DOM (cookie) → isolated world reads it. The session cookie is
attached by the network stack → no code. The bearer lives in the page's JS → MAIN world *if* you must
harvest it, else hard-code. The fetch must be same-origin → do it from the isolated content script
(page context), **not** the service worker (which would be a cross-origin request from the extension
origin and would *not* automatically carry the user's first-party cookies the same way).

---

## 6. The real fragility: `x-client-transaction-id`
X added an anti-automation header, **`x-client-transaction-id`**, computed client-side per request from
page-embedded key material (verification keys in `<meta>`/SVG/animation frames) + the HTTP method +
path + time, run through an obfuscated routine in the bundle. Many GraphQL endpoints now reject
requests lacking a valid value.
- This is the single biggest reason a hand-rolled call breaks even when cookies + bearer are perfect.
- Community implementations exist (e.g. a "Generate X-Client-Transaction-ID" userscript described as
  generating the "required X-Client-Transaction-ID Header for X API requests"; Python ports such as
  `XClientTransaction`; reverse-engineering writeups on antibot.blog "Twitter Header: Deobfuscation").
- **Most robust mitigation:** since your content script runs *on the page*, you can let the **page's
  own code** generate it. Either (a) run your fetch via MAIN-world so the genuine client code path is
  closest, or (b) observe a real request's `x-client-transaction-id` and the routine via the bundle.
  Hard-coding this header does **not** work (it's per-request). This is the part most likely to require
  ongoing maintenance — the webparsers writeup documents X shipping defensive breaking changes roughly
  every 2–4 weeks (guest-token format, `doc_id` rotation, cookie-validation tightening, etc.).

---

## 7. Policy / ToS considerations (read before shipping)

**This is the binding constraint, independent of technique.**

- **X Terms of Service (2025-05-08), "use terms":**
  > "You may not access the Services in any way other than through the currently available, published
  > interfaces that we provide. For example, this means that you **cannot scrape the Services without
  > X's express written permission**, try to work around any technical limitations we impose, or
  > otherwise attempt to disrupt the operation of the Services."
- **Same ToS, prohibited conduct:**
  > "(NOTE: **crawling or scraping the Services in any form, for any purpose without our prior written
  > consent is expressly prohibited**)".
- The **private GraphQL endpoints under `/i/api/graphql/...` are not a "published interface"** in the
  developer-API sense — they are the web app's internal RPC. Reusing them programmatically, and
  reusing the static web bearer, is reasonably read as "accessing the Services other than through
  published interfaces" and as working around technical limitations (esp. when defeating
  `x-client-transaction-id`).
- **X Developer Policy** additionally governs anyone "accessing X Content": automation/write actions
  must follow the Automation Rules; bulk/aggressive actions and platform manipulation are prohibited;
  redistribution of X Content to third parties is restricted (you may generally only redistribute
  Post/DM/User **IDs**, capped at 1.5M Post IDs per entity per 30 days); and "You must keep all API
  keys or other access credentials private … You may not use … access credentials owned by others."
- **Practical risk surface:**
  - **Account action:** X may rate-limit, lock, or suspend the *user's* account for non-standard
    client behavior (the `x-twitter-active-user`/transaction-id machinery exists partly to detect it).
  - **Extension-store risk:** Chrome Web Store and Firefox AMO review can reject/remove extensions that
    use undocumented endpoints of a third-party site or violate that site's ToS.
  - **Breakage:** `doc_id`/`queryId` rotation, `features` flag churn, and `x-client-transaction-id`
    enforcement mean this is a high-maintenance integration by design.
- **Lower-risk framing** (still not blessed, but materially better): operate **strictly as the
  logged-in user, on their own data, only while they are actively on the page**, with **no
  redistribution** of content off-device, no write/automation actions, and conservative request rates
  that mirror normal UI usage. This keeps you closest to "a power-user tool acting on the user's own
  authenticated session" rather than "a scraper." It does **not** cure the ToS "published interfaces"
  problem; for production at any scale, the compliant path is the **official paid X API** with proper
  OAuth credentials.

**Bottom line:** technically, Approach A is clean, minimal-permission, and reliable. Legally/policy-wise,
calling `/i/api/graphql` with the borrowed web bearer is in tension with the X ToS regardless of
technique; scope it to the user's own session and own data, avoid redistribution and automation, and
understand the maintenance + account-risk treadmill.

---

## Sources
- Chrome — Content scripts (isolated worlds, world default, MV3 CSP, same-DOM):
  https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome — `chrome.scripting` (`ExecutionWorld`, `MAIN`/`ISOLATED`, `world` option):
  https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome — `chrome.cookies` (needs `cookies` permission + host permissions; `httpOnly` field; runs in
  background/SW): https://developer.chrome.com/docs/extensions/reference/api/cookies
- Chrome — Declare permissions / host permissions:
  https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- MDN — Content scripts (MV3 content-script requests run in *page* context; same CORS as page; host
  perms don't apply to content scripts):
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
- MDN — `Request.credentials` (`same-origin` is default; `include` semantics; cookies are credentials):
  https://developer.mozilla.org/en-US/docs/Web/API/Request/credentials
- X internal API headers (logged-in/guest header set, bearer constant, ct0→x-csrf-token,
  x-twitter-active-user, x-twitter-client-language): fa0311/TwitterInternalAPIDocument —
  https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/sample.py and
  https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/API.json
- X GraphQL endpoint shape (queryId/variables/features, cursors):
  https://trekhleb.dev/blog/2024/api-design-x-home-timeline/
- `x-client-transaction-id` (required anti-bot header, generation): greasyfork
  https://greasyfork.org/en/scripts/536593-generate-x-client-transaction-id ;
  reverse-engineering: https://antibot.blog/posts/1741552025433 ;
  https://github.com/iSarabjitDhiman/XClientTransaction
- Breakage cadence (doc_id rotation, guest-token churn, cookie validation tightening):
  https://webparsers.com/how-to-scrape-x-com-twitter-in-2026/
- X cookies (what ct0/auth_token are): https://help.x.com/en/rules-and-policies/x-cookies
- X Terms of Service 2025-05-08 (no access outside published interfaces; no scraping without written
  permission; crawling/scraping prohibited without prior written consent):
  https://cdn.cms-twdigitalassets.com/content/dam/legal-twitter/site-assets/terms-of-service-2025-05-08/en/x-terms-of-service-2025-05-08.pdf
- X Developer Policy (automation rules, redistribution limits, keep credentials private):
  https://docs.x.com/developer-terms/policy
- X bans crawling/scraping (context): https://techcrunch.com/2023/09/08/x-updates-its-terms-to-ban-crawling-and-scraping/
