# Chrome Manifest V3 — Research Notes for an x.com UI-injection Extension

Scope: an MV3 extension that (1) injects an interactive UI into `x.com` / `twitter.com`,
(2) reads the user's existing logged-in x.com session to make authenticated requests,
and (3) persists small settings. All API facts below are from official Chrome /
MDN docs unless flagged otherwise.

Last researched: 2026-06-07. Chrome docs cited are the current `developer.chrome.com/docs/extensions/*` pages.

---

## 0. The single most important design decision for THIS extension

Authenticated requests to x.com must reuse the user's existing session cookies.
Two facts from official docs drive the whole architecture:

1. A **content script** "initiate[s] requests on behalf of the web origin that the
   content script has been injected into and therefore content scripts are also
   subject to the same origin policy." It runs *in the page's origin* (`x.com`), so a
   `fetch()` it makes is **same-origin to x.com and automatically carries the user's
   x.com cookies** (including `HttpOnly` auth cookies and the `ct0`/CSRF cookie),
   exactly like the site's own JS.
   Source: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

2. A `fetch()` from the **service worker / extension pages** runs from the *extension
   origin* (`chrome-extension://…`). With `host_permissions` it is allowed cross-origin
   to x.com, BUT MDN states host permissions grant un-restricted cross-origin fetch
   "**but not for requests from content scripts**", and more importantly the SW fetch is
   a cross-site request from the extension origin: third-party `SameSite=Lax/Strict`
   cookies will generally NOT be attached, so it is **not** a drop-in way to ride the
   user's session.
   Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions

=> **Conclusion for this extension: do the authenticated x.com API calls FROM the
content script (same-origin, cookies + CSRF token ride along), not from the service
worker.** Use the service worker only for orchestration, storage, and calls to *your
own* backend if any. x.com's GraphQL/v1.1 API also requires a `x-csrf-token` header
that must equal the `ct0` cookie value and a bearer token — the content script can read
`document.cookie` for `ct0` (it is NOT HttpOnly) and reuse the page's bearer.
(That request-shape detail is community/observed knowledge — medium confidence — but the
same-origin cookie behavior is from official docs.)

---

## 1. manifest.json v3 — structure & required keys

Source: https://developer.chrome.com/docs/extensions/reference/manifest
Sub-keys: https://developer.chrome.com/docs/extensions/reference/manifest/manifest-version ,
/name , /version , /key , /minimum-chrome-version

**Required keys** (minimal valid manifest per official "Minimal Manifest" example):
```json
{
  "manifest_version": 3,
  "name": "X Timeline Filter",
  "version": "1.0.0"
}
```
- `manifest_version`: MUST be the integer `3`.
- `name`: string (≤ 75 chars recommended).
- `version`: 1–4 dot-separated integers, e.g. `"1.0.0"`.

**Commonly-needed keys for this extension:**
```json
{
  "manifest_version": 3,
  "name": "X Timeline Filter",
  "version": "1.0.0",
  "description": "...",
  "icons": { "16": "...", "32": "...", "48": "...", "128": "..." },
  "action": { "default_popup": "popup.html", "default_icon": {...} },
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [ { "matches": ["https://x.com/*", "https://twitter.com/*"], "js": ["content.js"], "css": ["ui.css"], "run_at": "document_idle" } ],
  "permissions": ["storage"],
  "host_permissions": ["https://x.com/*", "https://twitter.com/*"],
  "web_accessible_resources": [ { "resources": ["injected.js","ui.html"], "matches": ["https://x.com/*","https://twitter.com/*"] } ],
  "minimum_chrome_version": "120"
}
```
- `background.service_worker` is a **single file path string** (not an array). Add
  `"type": "module"` to use ES-module `import`. (In a SW you can also call
  `importScripts()` for classic scripts.)
- `action` replaces MV2 `browser_action`/`page_action`.
- `key`: only needed to pin a stable extension ID during development; usually omitted.
- `minimum_chrome_version`: set this if you rely on newer SW-lifetime behavior (see §4).

---

## 2. content_scripts — matches, run_at, css, js, world

Source: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
Concept: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

Only `"matches"` and either `"js"` or `"css"` are required. Supported keys:
```json
{
  "matches": ["https://x.com/*", "https://twitter.com/*"],
  "css": ["ui.css"],
  "js": ["content.js"],
  "exclude_matches": ["*://*/*foo*"],
  "include_globs": ["*"],
  "exclude_globs": ["*bar*"],
  "all_frames": false,
  "match_about_blank": false,
  "run_at": "document_idle",
  "world": "ISOLATED"
}
```
- **matches** (required): match patterns deciding where scripts inject. Use BOTH
  `https://x.com/*` and `https://twitter.com/*` (twitter.com still resolves/redirects).
- **css**: array of CSS paths, injected in array order, "before any DOM construction or
  page rendering occurs."
- **js**: array of JS paths, injected in array order, **after** css. Leading `/` trimmed.
- **run_at**: `document_start` | `document_end` | `document_idle` (default
  `document_idle`). For an SPA like x.com that builds its DOM late and re-renders on
  client navigation, `document_idle` is fine; you must still observe DOM mutations to
  re-attach your UI on route changes (see pitfalls).
- **all_frames** (default false): only topmost frame unless true.
- **match_about_blank** (default false).

### `"world"` — ISOLATED vs MAIN
- Default `"ISOLATED"`: "the execution environment unique to the content script." The
  content script shares the **DOM** with the page but NOT the page's JS variables/
  functions. This is the safe default and is what you want for injecting UI.
- `"MAIN"`: "the script will share the execution environment with the host page's
  JavaScript." Docs carry an explicit **Warning**: "The host page can access and
  interfere with the injected script." Use MAIN only if you must read/patch x.com's
  in-page JS objects (e.g. grab the page's bearer token from a global, or hook
  `window.fetch`).
  Source (warning): https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts

**Key constraint for this extension:** `chrome.*` extension APIs are largely
unavailable in a MAIN-world script. The official content-scripts page says content
scripts can directly access only a limited set (e.g. `dom`, `i18n`, `storage`,
`runtime` subset) and must otherwise message the SW. A MAIN-world script has *no*
`chrome.runtime` access at all. Common pattern: an ISOLATED content script does the
work + messaging; if you need page-global data, it injects a small MAIN-world bridge
(via `world:"MAIN"` registration or a `<script>` tag pointing at a
web_accessible_resource) and the two halves talk via `window.postMessage`.

### Isolated worlds (concept)
Source: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
"An isolated world is a private execution environment that isn't accessible to the page
or other extensions." Each extension gets its own world; content script and page can
both touch the DOM but cannot read each other's JS context/variables.

---

## 3. chrome.scripting API & programmatic injection

Source: https://developer.chrome.com/docs/extensions/reference/api/scripting

Requires `"scripting"` permission + host permissions for the target page (or
`activeTab`). `executeScript()` moved from `chrome.tabs` (MV2) to `chrome.scripting`.

- **Inject a file:**
```js
chrome.scripting.executeScript({
  target: { tabId },                 // tabId is the only required target field
  files: ["script.js"]
});
```
- **Inject a function (with serializable args):**
```js
function changeColor(color) { document.body.style.background = color; }
chrome.scripting.executeScript({
  target: { tabId },
  func: changeColor,
  args: ["#1da1f2"]                   // args MUST be JSON-serializable
});
```
  The injected function is a *copy* — it cannot close over variables from the SW; pass
  everything via `args`.
- **Target options:** `{ tabId }`, `{ tabId, allFrames: true }`, `{ tabId, frameIds: [...] }`.
- **CSS:** `chrome.scripting.insertCSS(...)` / `removeCSS(...)`. Only `insertCSS`
  accepts a raw `css` string; `executeScript` cannot execute a code string (MV3 CSP).
- **world** option also exists here: `world: "MAIN" | "ISOLATED"`, plus
  `injectImmediately`.
- **Dynamic content scripts** (register without re-listing in manifest, Chrome 96+):
  `chrome.scripting.registerContentScripts([...])`, `updateContentScripts`,
  `getRegisteredContentScripts`, `unregisterContentScripts({ids:[...]})`.
  Source: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts

For this extension a **static** content_scripts declaration is simplest. Use
programmatic/dynamic injection only if you adopt `activeTab` + optional host
permissions (less scary install prompt) instead of declared host_permissions.

---

## 4. Service worker lifecycle (event-driven, non-persistent) & messaging

### Lifecycle
Source: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

- Install order: SW `install` → `chrome.runtime.onInstalled` → SW `activate`. Unlike
  web SWs, `activate` fires immediately after install (no page-reload analog).
  Use `onInstalled` for one-time setup (e.g. context menus, default settings) and guard
  on `details.reason` (`"install"` / `"update"`).
- `chrome.runtime.onStartup` fires when the profile starts (no SW events fire then).
- **Termination — Chrome kills the SW when:**
  - 30 seconds of inactivity (receiving an event or calling an extension API resets it),
  - a single event/API call takes longer than 5 minutes,
  - a `fetch()` response takes more than 30 seconds.
- "Any global variables you set will be lost if the service worker shuts down. Instead
  of using global variables, save values to storage." => never keep auth/UI state in SW
  module-scope; use `chrome.storage.session` (in-memory, survives SW restarts within a
  browser session) or `chrome.storage.local`.
- The SW has **no DOM / no `window`**; use `self`, `importScripts`, `fetch`, IndexedDB,
  CacheStorage.
- Lifetime-extending behaviors (Chrome ~110+; set `minimum_chrome_version` if relied on):
  active `chrome.debugger` session, active WebSocket (send/recv resets idle timer),
  `runtime.connectNative` host, messages from an offscreen document, sending a message
  on a long-lived port. **Opening a port no longer resets timers**; only actual
  message traffic does.
- Design for resilience against unexpected termination; re-derive state from storage.
- Do NOT use hacky keep-alive pings to pin the SW alive indefinitely — docs explicitly
  say avoid keeping it alive unnecessarily.

### Messaging
Source: https://developer.chrome.com/docs/extensions/develop/concepts/messaging

**One-shot messages:**
```js
// sender (content script or popup)
const res = await chrome.runtime.sendMessage({ type: "getStatus" });
// SW -> content script in a specific tab:
const res = await chrome.tabs.sendMessage(tabId, { type: "applyFilter" });
```
```js
// receiver
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  fetch(/*...*/).then(r => sendResponse({ status: r.status }));
  return true;   // <-- REQUIRED to keep the channel open for async sendResponse
});
```
- **Returning `true`** from the listener keeps the message channel open so you can call
  `sendResponse` asynchronously. Without it, by default `sendResponse` must be called
  synchronously and the channel closes.
- You may declare the listener `async` and return a Promise — BUT note: "an async
  function as a listener will always return a promise, even without a return
  statement," which can hijack the response for *other* listeners. The docs warn about
  this; prefer returning `true` + explicit `sendResponse`, OR ensure exactly one
  listener handles a given message.
- If multiple listeners are registered, only the first to call `sendResponse` (or whose
  promise settles) wins.
- From **Chrome 146**, if an `onMessage` listener throws or returns a rejecting
  promise, the sender's `sendMessage()` promise rejects with the error (rolling out;
  previously it just resolved with `undefined`). Non-serializable responses reject the
  sender's promise.

**Long-lived connections (ports):**
```js
const port = chrome.runtime.connect({ name: "stream" });
port.postMessage({ ... });
port.onMessage.addListener(msg => { ... });
// other end:
chrome.runtime.onConnect.addListener(port => {
  port.onMessage.addListener(msg => port.postMessage({ ... }));
});
```
Use ports for streaming/repeated traffic (e.g. progressive filtering results). Note:
merely opening a port no longer keeps the SW alive (see lifecycle).

---

## 5. permissions vs host_permissions vs optional_host_permissions for x.com

Source: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
Also: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

Four permission-bearing manifest keys:
- **`permissions`** — known API permission strings (`"storage"`, `"scripting"`,
  `"cookies"`, `"activeTab"`, `"contextMenus"`, `"alarms"`, …). Changes may trigger a
  reinstall warning.
- **`optional_permissions`** — same kinds of strings, granted at runtime via
  `chrome.permissions.request()` instead of at install.
- **`host_permissions`** — match patterns granting host access (e.g.
  `"https://x.com/*"`, `"https://twitter.com/*"`). Needed to:
  - make cross-origin `fetch()` from the **SW/extension pages** to that host,
  - read sensitive `tabs` props (`url`, `title`, `favIconUrl`),
  - inject content scripts **programmatically**,
  - use `chrome.cookies` for that host (also needs `"cookies"` permission),
  - `webRequest` / `declarativeNetRequest` on that host.
  Changing match patterns here (or in `content_scripts.matches`) triggers a permission
  warning on update and can **disable the extension until the user re-approves**.
- **`optional_host_permissions`** — host patterns granted at runtime.

For THIS extension:
```json
"permissions": ["storage"],
"host_permissions": ["https://x.com/*", "https://twitter.com/*"]
```
- `host_permissions` for x.com is needed only if the SW itself fetches x.com OR you
  inject programmatically. If all x.com calls are made from a **statically declared
  content script** (recommended, §0), the `content_scripts.matches` entry already
  authorizes that injection — you may not strictly need x.com in `host_permissions` for
  the content-script path. Add it if the SW must talk to x.com or you use
  `chrome.cookies`.
- **`activeTab`** is a lighter alternative to broad host permissions: it grants
  temporary host access to the active tab when the user invokes the extension (click),
  avoiding a scary install-time warning. Consider `activeTab` + dynamic injection if
  you want minimal warnings, but it's a poorer fit for an always-on timeline UI.
- Best practice from docs: prefer `optional_permissions`/`optional_host_permissions`
  where possible to reduce install-time warnings and give users informed control.
- `extension.isAllowedIncognitoAccess()` / `isAllowedFileSchemeAccess()` detect special
  grants.

`chrome.cookies` (only if you read cookies from the SW):
Source: https://developer.chrome.com/docs/extensions/reference/api/cookies
- Needs `"cookies"` permission + host_permissions for the host. `getAll()` "only
  retrieves cookies for domains that the extension has host permissions to."
- Can read `HttpOnly` cookies (the `httpOnly` field is exposed) — this is the ONLY way
  to read x.com's HttpOnly auth cookie from outside the page. `partitionKey` handles
  partitioned (CHIPS) cookies; x.com may set partitioned cookies, so account for it.
- Note: even with the cookie *values*, a SW fetch still won't auto-attach them as
  first-party — you'd have to set headers manually, and many auth cookies are HttpOnly
  and tied to TLS-bound/secure flows. Hence §0's recommendation to fetch from the
  content script.

---

## 6. chrome.storage (local / sync / session, quotas)

Source: https://developer.chrome.com/docs/extensions/reference/api/storage

Async, bulk get/set; survives cache clears (unlike `localStorage`). Areas:

| Area | Persistence | Quota | Exposed to content scripts by default? |
|------|-------------|-------|----------------------------------------|
| `local` | Until extension removed | 10 MB (`QUOTA_BYTES` = 10485760; 5 MB ≤ Chrome 113). `unlimitedStorage` permission lifts it. | Yes |
| `sync` | Synced across the user's signed-in Chrome browsers; acts like local if sync off | ~100 KB total, **8 KB per item** (`QUOTA_BYTES_PER_ITEM`), ~512 items | Yes |
| `session` | In-memory; cleared on disable/reload/update/browser restart | 10 MB (`QUOTA_BYTES`; 1 MB ≤ Chrome 111) | **No** (default) |
| `managed` | Read-only, enterprise policy | n/a | Yes |

- For "small settings" => **`chrome.storage.sync`** (roams with the user; mind the 8 KB/
  item and 100 KB total caps — keep settings tiny, don't store tokens here).
- For per-session caches / SW state => **`chrome.storage.session`** (memory only; docs
  recommend it for SWs and for "sensitive user data").
- Quota overflow: "Updates that would cause this limit to be exceeded fail immediately
  and set `runtime.lastError` … or a rejected Promise." So await + handle errors.
- `getBytesInUse()` to check usage; `setAccessLevel()` to expose/hide an area to content
  scripts (e.g. expose `session` to content scripts if needed).
- React to changes across contexts with `chrome.storage.onChanged`:
```js
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.options?.newValue) applyOptions(changes.options.newValue);
});
```
- Do NOT store the x.com auth token/cookies in storage; read them live (content script /
  `chrome.cookies`) to avoid stale-token and secret-at-rest problems.

---

## 7. Cross-origin fetch: content script vs service worker

Source: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests

- **From content script:** runs in the page's origin and is subject to same-origin
  policy *of that page*. A `fetch()` to `https://x.com/i/api/...` from a content script
  injected on x.com is **same-origin → cookies attached automatically** (this is the
  authenticated path you want). Cross-origin fetches from a content script are blocked
  even if the extension has host permissions ("Cross-origin requests are always treated
  as such in content scripts, even if the extension has host permissions").
- **From SW / extension pages:** the extension origin can fetch any host listed in
  `host_permissions` cross-origin without CORS. Example:
```js
const r = await fetch("/config_resources/config.json"); // extension's own resource
```
  But these requests originate from `chrome-extension://…`, so third-party
  `SameSite=Lax/Strict` cookies for x.com are generally not sent (MDN, §0). Use the SW
  for calls to *your own* backend, telemetry, or non-cookie-bound endpoints.

**Secure proxy pattern (when content script needs the SW to fetch):** never let the
content script pass a full URL to the SW to fetch (a malicious page can forge the
message). Pass only an opaque parameter and build the URL in the SW:
```js
// BAD: fetch(request.url) — arbitrary SSRF-style abuse
// GOOD:
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.contentScriptQuery === "queryPrice") {
    const url = `https://api.example.com/price?itemId=${encodeURIComponent(request.itemId)}`;
    fetch(url).then(r => r.text()).then(t => sendResponse(parsePrice(t)));
    return true;
  }
});
```
Prefer HTTPS always (MITM risk on hostile networks).

---

## 8. MV3 CSP constraints

Source: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
Migration: https://developer.chrome.com/docs/extensions/develop/migrate/improve-security

Default CSP (applied to extension pages + the SW):
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self';",
  "sandbox": "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self';"
}
```
Consequences:
- Only **local, packaged** scripts/objects run. **No** inline `<script>`, no inline
  event handlers, no `eval()`, no `new Function()`, no executing strings; WebAssembly
  disabled by default.
- The `extension_pages` policy **cannot be relaxed** beyond the documented minimum
  (`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`). You CANNOT add
  `'unsafe-eval'` or remote script hosts — Chrome rejects the manifest at install:
  "Insecure CSP value … in directive 'script-src'."
- **No remotely-hosted code** (Chrome Web Store policy): "all of your extension's logic
  must be part of the extension package." Bundle everything; libraries that fetch code
  at runtime (e.g. Firebase) must be pre-bundled or used via a sandboxed iframe.
  `eval`/`new Function` are still allowed inside **sandboxed iframes** (which have no
  extension-API access). You may still fetch **data** (JSON, config) remotely.
- If you add `content_security_policy` to connect to your own backend, you must allow
  those hosts via `connect-src`/`default-src` — but note connecting (fetch) is allowed
  by default; the restriction is on *script* sources.
- This means your injected UI (§9) must come from bundled JS/CSS, set styles via
  packaged stylesheets or `element.style`/`textContent`, never via `innerHTML` of
  remote data (XSS — docs explicitly warn: prefer `textContent`/`JSON.parse`, never
  `innerHTML` of fetched data).

---

## 9. Safely injecting UI via Shadow DOM

Official Chrome docs don't have a single "use Shadow DOM" page, but the content-scripts
docs' isolated-world model + the CSP/XSS guidance below drive the recommended pattern.
(The Shadow-DOM-for-style-isolation technique is widely-documented best practice —
medium confidence as "official", high confidence as correct engineering.)

Why Shadow DOM here: x.com ships heavy global CSS and React that constantly re-renders
and can clobber injected nodes. A closed/open shadow root isolates your UI's styles
both ways (page CSS won't leak in; your CSS won't leak out).

Recommended pattern:
```js
// content.js (ISOLATED world)
const host = document.createElement("div");
host.id = "xtf-root";
host.style.all = "initial";                 // neutralize inherited styles on the host
document.documentElement.appendChild(host); // attach high in the tree to survive re-renders
const shadow = host.attachShadow({ mode: "open" });

// styles: inject packaged CSS into the shadow root, NOT the page
const style = document.createElement("style");
style.textContent = CSS_TEXT;               // bundled string, or <link> to a web_accessible_resource
shadow.appendChild(style);

// build UI with DOM APIs / textContent — never innerHTML of remote data
const panel = document.createElement("div");
panel.className = "panel";
shadow.appendChild(panel);
```
Notes:
- Content scripts share the DOM, so `attachShadow` works from the ISOLATED world.
- CSS declared in `content_scripts.css` injects into the **page** document, not your
  shadow root, so for shadow-encapsulated styling either inline a `<style>` in the
  shadow root or fetch a `web_accessible_resources` CSS file.
- Any asset the page (or your shadow UI loaded as page-context) must reach
  (images, fonts, an iframe'd UI HTML, a MAIN-world bridge script) must be listed in
  `web_accessible_resources` with a `matches` scoped to x.com.
- XSS: when rendering fetched x.com data into your UI, use `textContent`, not
  `innerHTML`. (Network-requests docs security section.)
- Watch x.com's SPA navigation + virtualized timeline: use a `MutationObserver` on the
  timeline container to re-attach per-tweet UI; debounce. Re-insert your shadow host if
  React removes it.

---

## 10. Load-unpacked dev / debug workflow

Source: https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world

1. `chrome://extensions` (chrome:// URLs aren't linkable — type it). Or puzzle-piece
   menu → Manage Extensions.
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → select the extension directory (the folder containing
   `manifest.json`).
4. Pin the extension to the toolbar for quick access during dev.

**What requires a reload (`chrome://extensions` → reload icon on the card):**

| Component | Requires extension reload |
|-----------|---------------------------|
| The manifest | Yes |
| Service worker | Yes |
| Content scripts | Yes (plus reload the host page) |
| The popup | No |
| Options page | No |

**Debugging:**
- SW logs/errors: click the **"service worker"** (Inspect views) link on the card to
  open dedicated DevTools for the SW.
- Popup: right-click the popup → Inspect.
- Content scripts: appear in the host page's DevTools console (select the extension's
  context in the JS context dropdown to see ISOLATED-world logs).
- An **Errors** button appears on the card when something throws; click for details.
- For a build step (bundler), use `npm run`/`bun run` watch + reload; consider a
  reload-on-change helper during development.

---

## 11. Concrete pitfalls (this extension)

1. **Fetching x.com from the SW won't carry the session.** SW fetch is from the
   extension origin; first-party `SameSite` auth cookies aren't attached. Do
   authenticated calls from the content script (same-origin). (Docs §0/§7.)
2. **x.com requires CSRF + bearer headers.** Even from the content script, x.com's
   `/i/api/graphql/...` needs `x-csrf-token: <ct0 cookie>` and the
   `authorization: Bearer ...` header. Read `ct0` from `document.cookie` (not HttpOnly);
   reuse the page bearer (often hooked from MAIN world or a known constant). (Observed,
   medium confidence — not in official docs.)
3. **`world:"MAIN"` has no `chrome.*` APIs and is page-attackable.** Keep logic in
   ISOLATED; use MAIN only as a thin bridge via `window.postMessage`. (Docs warning, §2.)
4. **SW global state is volatile.** SW dies after 30 s idle / 5 min task / 30 s slow
   fetch. Never hold tokens/UI state in SW module scope — use `storage.session`. (§4.)
5. **Opening a port no longer keeps the SW alive.** Only message traffic / specific APIs
   do. Don't rely on an idle port as a keep-alive. (§4.)
6. **`return true` in `onMessage`** is mandatory for async `sendResponse`, or the reply
   is dropped. Async-listener-returns-a-promise gotcha can swallow responses meant for
   other listeners. (§4.)
7. **storage.sync caps:** ~100 KB total, **8 KB per item**, ~512 items. Big settings or
   caches must go in `storage.local` (10 MB). Quota overflow rejects the write. (§6.)
8. **Changing `host_permissions`/`content_scripts.matches` on update triggers a
   permission re-prompt** and can disable the extension until re-approved. Pick patterns
   carefully up front. (§5.)
9. **No remote code / no eval / no inline scripts (MV3 CSP).** Bundle all JS; can't add
   `'unsafe-eval'` or remote script hosts to `extension_pages`. Remote JS only via
   sandboxed iframe (no DOM access to page) or as data. (§8.)
10. **XSS via innerHTML of fetched data.** Use `textContent` / `JSON.parse`; never
    `innerHTML` of x.com response data. (§7/§8 security sections.)
11. **x.com is an SPA with virtualized timeline.** Content script runs once at
    `document_idle`; the timeline mutates and React removes injected nodes. Use a
    `MutationObserver` + re-attach, and Shadow DOM to survive CSS churn. (§9.)
12. **twitter.com vs x.com.** Include both in `matches`/`host_permissions`; cookie host
    and API host can differ; partitioned (CHIPS) cookies need `partitionKey` if you read
    via `chrome.cookies`. (§5.)
13. **executeScript `func` is a copied closure** — it can't see SW variables; pass data
    via `args` (must be JSON-serializable). (§3.)
14. **Content-script-declared CSS injects into the page, not your shadow root.** For
    encapsulated styling, inline `<style>` in the shadow root or load a
    web_accessible_resource CSS file. (§9.)
15. **web_accessible_resources is required** for any file the page/MAIN-world must load
    (bridge script, iframe HTML, fonts/images), and must be scoped with `matches`.

---

## Source URLs (primary unless noted)

- Manifest reference: https://developer.chrome.com/docs/extensions/reference/manifest
- content_scripts manifest key: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- Content scripts concept (isolated worlds, world field, dynamic/programmatic): https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- SW lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Declare permissions: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
- storage API: https://developer.chrome.com/docs/extensions/reference/api/storage
- Cross-origin network requests: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- CSP manifest key: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
- Improve security / remove remote code: https://developer.chrome.com/docs/extensions/develop/migrate/improve-security
- cookies API: https://developer.chrome.com/docs/extensions/reference/api/cookies
- Hello World / load unpacked + reload table: https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
- MDN host_permissions (cookie/cross-origin nuance): https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions
