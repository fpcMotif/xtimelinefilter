# Adversarial Verification — Chrome MV3 Fundamentals (track 01-chrome-mv3)

Date: 2026-06-07. Verifier independently re-checked each claim against PRIMARY/OFFICIAL sources. Default to "uncertain" unless corroborated. Tried hard to refute.

## Tooling note
- `mgrep --web` was quota-exhausted (HTTP 429, "exceeded the monthly limit of 100 searches", resets next month). Built-in WebSearch NOT used (project policy).
- All corroboration done via `curl -sSL` on `developer.chrome.com` and `developer.mozilla.org` (primary vendor docs). HTML stripped to text locally and grepped.

---

## Claim 1 — Make authenticated x.com calls from the CONTENT SCRIPT, not the SW — CONFIRMED (with one wording correction)

Primary evidence (https://developer.chrome.com/docs/extensions/develop/concepts/network-requests):
- Verbatim: "Content scripts initiate requests on behalf of the web origin that the content script has been injected into and therefore content scripts are also subject to the same origin policy."
- Verbatim: "A script executing in an extension service worker or foreground tab can talk to remote servers outside of its origin, as long as the extension requests host permissions." → SW runs from the `chrome-extension://` origin, so a fetch to x.com is cross-origin.
- Verbatim: "Cross-origin requests are always treated as such in content scripts, even if the extension has host permissions."

MDN host_permissions (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions):
- Verbatim: host_permissions grant "XMLHttpRequest and fetch access to those origins without cross-origin restrictions, **but not for requests from content scripts**." → CONFIRMS the claim's MDN quote exactly.

Cookie-attachment reasoning independently corroborated:
- `fetch()` `credentials` defaults to **`same-origin`** (https://developer.mozilla.org/en-US/docs/Web/API/RequestInit): "Defaults to same-origin"; "same-origin: Only send and include credentials for same-origin requests." → A SW fetch to x.com (cross-origin from `chrome-extension://`) with DEFAULT credentials sends **no** cookies at all unless `credentials:'include'` is set explicitly.
- SameSite semantics (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie/SameSite — note: lives under .../Reference/Headers/...): `Strict` = sent only for same-site requests; `Lax` adds cross-site **top-level navigations** only ("causes the URL shown in the browser's address bar to change"). A programmatic `fetch()` is not a top-level navigation, so even with `credentials:'include'`, x.com's first-party `SameSite=Lax/Strict` auth cookies are withheld from a cross-site SW fetch. By contrast a content-script fetch on x.com→x.com is **same-origin / same-site**, default credentials attach the session, SameSite is satisfied.

NET: the claim's core recommendation and reasoning are correct and well-sourced.

**CORRECTION (wording, not substance):** The claim says "Cross-origin fetch from a content script is always blocked even with host permissions." The doc says such requests are "always treated as [cross-origin]" — i.e. subject to the Same-Origin Policy / CORS, NOT unconditionally "blocked." A CORS-enabled cross-origin endpoint (with `Access-Control-Allow-Origin`) WOULD still succeed from a content script. The accurate phrasing is "always subject to CORS / not granted cross-origin privileges by host_permissions," not "always blocked." (For the x.com→x.com same-origin path this distinction does not matter — that path is exactly what's wanted.)

---

## Claim 2 — content_scripts requires matches + (js or css); world ISOLATED(default) vs MAIN — CONFIRMED

https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts:
- Verbatim: "Only the `matches` key and either `js` or `css` are required."
- Supported keys confirmed in the doc's example + descriptions: matches (Required), js, css, exclude_matches, include_globs, exclude_globs, all_frames, match_about_blank, run_at (default `document_idle`), world (`ISOLATED`|`MAIN`, default `ISOLATED`). All present.
- css: "An array of CSS file paths, injected in the order of this array, **and before any DOM construction or page rendering occurs**." → CONFIRMS "css injects before DOM render, in array order."
- js: "injected in the order they appear in this array, **after css files are injected**." → CONFIRMS "js after css, in array order."
- run_at: default `document_idle`; values document_start|document_end|document_idle. CONFIRMED.
- world: Verbatim "Defaults to `ISOLATED`, which is the execution environment unique to the content script. Choosing the `MAIN` world means the script will share the execution environment with the host page's JavaScript." CONFIRMED.
- MAIN Warning verbatim: "There are risks involved when using the `MAIN` world. **The host page can access and interfere with the injected script.**" → CONFIRMS the claim's explicit-Warning detail.

"Use both https://x.com/* and https://twitter.com/* in matches" — practical/community recommendation (twitter.com 301s to x.com today). Sensible defensive measure; not a doc claim. Does not affect verdict.

---

## Claim 3 — scripting.executeScript: files, func+args(serializable), target{tabId}, world; insertCSS for raw CSS — CONFIRMED

https://developer.chrome.com/docs/extensions/reference/api/scripting:
- "The only required field is `tabId`. By default, an injection will run in the main frame." CONFIRMED.
- func: "This function will be serialized, and then deserialized for injection. **This means that any bound parameters and execution context will be lost.**" → CONFIRMS "injected as a COPY; cannot close over SW variables."
- args: "These arguments must be **JSON-serializable**." CONFIRMED.
- Raw string: "you can also specify a string to be used in the `css` property. **This option is only available for scripting.insertCSS(); you can't execute a string using scripting.executeScript().**" → CONFIRMS the CSP/string restriction.
- Dynamic content scripts API: registerContentScripts / updateContentScripts / getRegisteredContentScripts / unregisterContentScripts all present and tagged **"Chrome 96+"**. CONFIRMS the "Chrome 96+" detail.
- Programmatic injection needs host permissions or activeTab: doc top "declare the `scripting` permission ... plus the host permissions for the pages to inject scripts into. Use the `host_permissions` key or the `activeTab` permission." CONFIRMED (also reinforced by content-scripts concept, see Claim 6).

---

## Claim 4 — SW event-driven, non-persistent; terminate at 30s idle / 5min task / 30s slow fetch — CONFIRMED (one sourcing caveat)

https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle:
- Termination conditions verbatim: "After 30 seconds of inactivity." / "When a single request, such as an event or API call, takes longer than 5 minutes to process." / "When a fetch() response takes more than 30 seconds to arrive." ALL CONFIRMED.
- Install order: install (web SW event) → chrome.runtime.onInstalled → activate. Verbatim: "unlike web service workers, this event [activate] is fired **immediately after installation** of an extension because there is nothing comparable to a page reload in an extension." CONFIRMS "no page-reload analog."
- onStartup: "When a user profile starts, the `chrome.runtime.onStartup` event fires but no service worker events are invoked." CONFIRMED.
- Globals: "Any global variables you set will be lost if the service worker shuts down. Instead of using global variables, save values to storage." CONFIRMED.
- Timers reset / revive: "Events and calls to extension APIs reset these timers, and if the service worker has gone dormant, an incoming event will revive them." CONFIRMED.
- Lifetime extenders: active debugger session (chrome.debugger), active WebSocket traffic ("Sending or receiving messages across a WebSocket ... resets the service worker's idle timer"), native messaging (connectNative keeps alive), offscreen-document messages ("Messages sent from an offscreen document reset the timers"), long-lived port messaging ("Sending a message with long-lived messaging keeps the service worker alive"). ALL CONFIRMED.
- Verbatim corroboration of the subtle bit: "**Opening a port no longer resets the timers.**" CONFIRMS the claim's "merely OPENING a port no longer resets timers."
- minimum_chrome_version advice: "consider specifying a minimum Chrome version in your manifest." CONFIRMED.

**Sourcing caveat (not a refutation):** the sub-detail "No DOM/window; use self/importScripts" is accurate background but is NOT on the cited lifecycle page; it belongs to the "Extension service worker basics" page. Substance is correct; just attribute it to the right page.

---

## Claim 5 — onMessage: return true for async sendResponse; async-listener gotchas — CONFIRMED (two version corrections)

https://developer.chrome.com/docs/extensions/develop/concepts/messaging:
- "By default, the sendResponse callback must be called synchronously." CONFIRMED.
- "To respond asynchronously using sendResponse(), **return a literal true (not just a truthy value)** from the event listener. Doing so will keep the message channel open." CONFIRMS "return true keeps channel open."
- async gotcha verbatim: "an async function as a listener **will always return a promise, even without a return statement**. If an async listener does not return a value its promise implicitly resolves to undefined, and null is sent as the response... This can cause unexpected behavior when there are multiple listeners" (first listener's promise resolves to undefined → Chrome sends null before a later listener can respond). CONFIRMS the substance of the claim's "can hijack responses meant for other listeners" (the doc's wording is "unexpected behavior when there are multiple listeners"; "hijack" is the claim's paraphrase, fair).
- Throw/reject behavior: "**From Chrome 146**, if an onMessage listener throws an error (either synchronously, or asynchronously by returning a promise that rejects), the promise returned by sendMessage() in the sender will reject with the error's message." CONFIRMS the "Chrome 146" detail.
- tabs.sendMessage to reach content script: "call runtime.sendMessage() or tabs.sendMessage()" + the dedicated "to send a single message to ... a content script ... use tabs.sendMessage()." CONFIRMED.
- Long-lived: runtime.connect()/tabs.connect() + runtime.Port + runtime.onConnect listener. CONFIRMED.

**CORRECTION:** the claim treats "async-listener-returns-promise" as a present-day capability with gotchas. The doc states **returning a promise from a message listener is "From Chrome 148" and rolling out gradually** ("you may find that it's not yet available in all users' browsers ... `return true;` will continue to work ... whether this capability is enabled or not"). Also: promise support is NOT enabled if the extension extends DevTools with a devtools_page. The synthesis should: (a) attach "Chrome 148, gradual rollout" to promise-return, and (b) keep `return true` + explicit sendResponse as the portable recommendation. The "always returns a promise" gotcha for `async` listeners is real regardless of version (it's a JS-language fact), and is exactly why the doc warns against bare async listeners.

---

## Claim 6 — Four permission keys; host_permissions needed for SW fetch / cookies / programmatic injection / sensitive tabs props — CONFIRMED

https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions:
- Four keys present verbatim: `permissions`, `optional_permissions`, `host_permissions`, `optional_host_permissions`. CONFIRMED.
- "Adding or changing match patterns in the `host_permissions` and `content_scripts.matches` fields of the manifest file will also trigger a warning." → CONFIRMS re-prompt-on-update for BOTH host_permissions AND content_scripts.matches.
- "Consider using optional permissions wherever the functionality of your extension permits" / "Consider implementing optional permissions or a less powerful API to avoid alarming warnings." CONFIRMS the optional-permissions recommendation.

MDN host_permissions enumerates exactly what the privilege grants (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions): cross-origin fetch/XHR (not from content scripts), read tab-specific metadata (url/title/favIconUrl) without "tabs" permission, inject scripts programmatically into those origins, receive webRequest events, access cookies via cookies API "as long as the 'cookies' API permission is also included." ALL CONFIRMS the claim's enumeration.

activeTab as the lighter alternative (https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): "gives an extension temporary access to the currently active tab when the user invokes the extension" and "activeTab grants host permission temporarily." CONFIRMED.

KEY sub-claim — "a statically declared content_scripts.matches entry already authorizes that injection WITHOUT needing the host in host_permissions" — CONFIRMED via the asymmetry on https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts:
- Static (manifest content_scripts): registered under the `content_scripts` key; the doc never requires host_permissions for static declarations (only an install warning, per declare-permissions).
- Programmatic: verbatim "To inject a content script programmatically, your extension needs host permissions for the page it's trying to inject scripts into. Host permissions can either be granted by requesting them as part of your extension's manifest or temporarily using `activeTab`."
So host_permissions for x.com is only needed if the SW fetches x.com, uses chrome.cookies, programmatically injects, or uses webRequest/DNR — exactly as claimed.

"Changing host_permissions/matches ... can disable the extension until re-approved" — the warning trigger is confirmed here; the precise "disabled pending re-acceptance" detail lives on the linked "Updating permissions" page (documented Chrome behavior: an update that adds new warnings is held/disabled until the user re-accepts). Substance correct; cite the Updating-permissions page for the disable detail.

---

## Claim 7 — storage areas + quotas (local 10MB, sync ~100KB/8KB-item, session 10MB) — CONFIRMED

https://developer.chrome.com/docs/extensions/reference/api/storage:
- local: "storage limit is 10 MB (5 MB in Chrome 113 and earlier), but can be increased by requesting the `unlimitedStorage` permission ... By default, it's exposed to content scripts." Constant `QUOTA_BYTES = 10485760`. ALL CONFIRMED.
- session: "holds data in memory ... cleared if the extension is disabled, reloaded, updated, and when the browser restarts. By default, it's not exposed to content scripts ... The storage limit is 10 MB (1 MB in Chrome 111 and earlier)." Constant `QUOTA_BYTES = 10485760`. ALL CONFIRMED (in-memory, cleared on disable/reload/update/restart, NOT exposed to content scripts by default, 10MB / 1MB ≤Chrome111).
- sync: "If disabled, it behaves like storage.local ... The quota limitation is approximately 100 KB, 8 KB per item ... We recommend using storage.sync to preserve user settings ... If you're working with sensitive user data, instead use storage.session." Constants: `QUOTA_BYTES = 102400`, `QUOTA_BYTES_PER_ITEM = 8192`, `MAX_ITEMS = 512`. ALL CONFIRMED (~100KB total, 8KB/item, ~512 items, behaves like local when off, recommended for settings; session recommended for SW state + sensitive data).
- Overflow: "Updates that would cause this limit to be exceeded fail immediately and set runtime.lastError when using a callback, or a rejected Promise if using async/await." CONFIRMED.
- setAccessLevel() controls content-script exposure; onChanged(changes, namespace/area) for cross-context reactions. Both present and CONFIRMED.

---

## Claim 8 — MV3 CSP forbids eval/new Function/inline/remote code; extension_pages CSP cannot be relaxed — CONFIRMED

https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy:
- Default extension_pages CSP verbatim: `script-src 'self'; object-src 'self';`. CONFIRMED.
- Effect: "the extension won't run inline Javascript or be able to evaluate strings as executable code." CONFIRMED (no inline scripts, no eval).
- Cannot relax: "The extension_pages policy cannot be relaxed beyond this minimum value [`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`]. In other words, you cannot add other script sources ... such as adding 'unsafe-eval' to script-src. If you add a disallowed source ... Chrome will throw an error like this at install time: '...': Insecure CSP value "'unsafe-eval'" in directive 'script-src'." → CONFIRMS the 'wasm-unsafe-eval' ceiling AND the "Insecure CSP value" install rejection.
- Sandbox: default sandbox CSP allows `'unsafe-inline' 'unsafe-eval'`; sandbox pages have no extension-API / non-sandboxed-page access. CONFIRMED.

https://developer.chrome.com/docs/extensions/develop/migrate/improve-security:
- "You can no longer execute external logic using executeScript(), eval(), and new Function()." CONFIRMED.
- "eval and new Function(...) are still supported in sandboxed iframes." CONFIRMS eval-only-in-sandbox.
- Sandbox caveat: "this approach does not work if the code requires access to the embedding page's DOM." CONFIRMS the "no page-DOM access" qualifier.
- Remote code: "all of your extension's logic must be part of the extension package. You can no longer load and execute remotely hosted files according to Chrome Web Store policy." CONFIRMED.
- Data is fine: "Your extension loads and caches a remote configuration (for example a JSON file) at runtime." CONFIRMS "may still fetch DATA remotely."
- script-src/object-src/worker-src may only be `self` / `none` / `wasm-unsafe-eval`. CONFIRMED.

innerHTML/XSS guidance ("use textContent/JSON.parse, avoid innerHTML of fetched data") confirmed on the network-requests page security section. CONFIRMED.

---

## Claim 9 — Inject UI from ISOLATED CS via Shadow DOM; list page-loaded assets in web_accessible_resources — CONFIRMED for doc-backed parts (engineering parts correctly flagged)

https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts:
- CS share the page DOM: "Although the execution environments of content scripts and the pages that host them are isolated from each other, they share access to the page's DOM." → CONFIRMS attachShadow() works from the ISOLATED world (Shadow DOM is a DOM API; DOM is shared even though JS scopes are isolated).
- content_scripts.css targets the PAGE document (examples style `body { ... }`; manifest css is injected into the host document, not into a shadow root) — CONFIRMS "css injects into the PAGE document, not the shadow root," so encapsulated styling must be inlined in the shadow root or loaded as a WAR file.
- web_accessible_resources: any asset the page/main world loads (images, fonts, bridge scripts, iframe HTML) "must be declared as web accessible resources," scoped with `resources` + `matches` (MV3 object form). CONFIRMED — the doc's example uses `{ "resources":[...], "matches":["https://example.com/*"] }`, exactly the x.com-scoping pattern the claim describes.

Correctly flagged as engineering best-practice (NOT a single official doc page), so left UNREFUTED but uncertain-by-design:
- "Shadow DOM for style isolation" + "host.style.all='initial'" — standard web-platform technique, not a Chrome-extension doc claim.
- "x.com is an SPA with a virtualized timeline that re-renders/removes injected nodes — use a MutationObserver to re-attach" — observed/community knowledge about x.com's UI; not in Chrome docs. Plausible and standard practice, but not primary-sourced here.

Verdict: confirmed for the parts that are doc-backed (DOM sharing, css-into-page, WAR scoping). Medium confidence overall is the right calibration because the Shadow-DOM/MutationObserver/SPA-behavior portions are engineering practice, not official documentation.

---

## Claim 10 — Dev workflow: Developer mode → Load unpacked; manifest/SW/content-script changes need a reload, popup/options do not — CONFIRMED

https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world:
- "Go to the Extensions page by entering `chrome://extensions` in a new tab. (**By design chrome:// URLs are not linkable.**)" → CONFIRMS "chrome:// must be typed."
- "Enable Developer Mode by clicking the toggle ... Click the **Load unpacked** button and select the extension directory." CONFIRMED.
- Reload table verbatim: The manifest = Yes; Service worker = Yes; Content scripts = **Yes (plus the host page)**; The popup = No; Options page = No; Other extension HTML pages = No. → CONFIRMS the claim's reload table exactly (including "plus reload the host page" for content scripts).
- Debug popup: "Open the popup. Right-click the popup. Select Inspect." CONFIRMED.
- "An **Errors** button will appear. Click the Errors button to learn more about the error." CONFIRMS the Errors-button detail.

Sourcing note: "click the 'service worker' link on the card for SW DevTools" and "content-script logs appear in the host page's DevTools" are on the linked "Debugging extensions" page (referenced from this tutorial), not on the hello-world page itself. Substance is standard/correct; attribute those two specifics to the Debugging-extensions page.

---

## Claim 11 — chrome.cookies reads HttpOnly x.com cookies but doesn't make a SW fetch first-party; CHIPS need partitionKey — CONFIRMED

https://developer.chrome.com/docs/extensions/reference/api/cookies:
- "To use the cookies API, declare the `cookies` permission in your manifest along with host permissions for any hosts whose cookies you want [to access]." CONFIRMS "cookies permission + host_permissions."
- getAll(): "This method only retrieves cookies for domains that the extension has host permissions to." CONFIRMED.
- Cookie.httpOnly field exposed: "True if the cookie is marked as HttpOnly (i.e. the cookie is inaccessible to client-side scripts)." → reading this from the cookies API IS the way to obtain an HttpOnly cookie value from outside the page. CONFIRMED.
- Partitioned/CHIPS: "Partitioned cookies allow a site to mark that certain cookies should be keyed against the [top-level site] ... By default, all API methods operate on unpartitioned cookies. The `partitionKey` property can be used to override this behavior." `partitionKey` present on get/getAll/set. CONFIRMS the CHIPS/partitionKey detail.
- SameSite enum exposed (no_restriction/lax/strict/unspecified), reinforcing why a cross-site SW fetch won't carry SameSite=Lax/Strict cookies (see Claim 1). CONFIRMED in substance: having a cookie's value does not make a programmatic cross-site SW fetch first-party.

Correctly flagged as community/observed (NOT official docs): the exact x.com request shape — `x-csrf-token` = `ct0` cookie, `authorization: Bearer ...`, `/i/api/graphql/...` endpoints. This is reverse-engineered knowledge; medium confidence is correct. (Cross-corroborated locally elsewhere in this repo's research, e.g. verify-reference-repo-hunt.md, but not in primary Chrome docs.)

---

## Summary of corrections the synthesis must apply
1. **Claim 1 wording:** "cross-origin fetch from a content script is always blocked even with host permissions" → should read "always treated as cross-origin / subject to CORS" (a CORS-enabled endpoint still works). The same-origin x.com→x.com path is unaffected and remains the recommended approach.
2. **Claim 5 versioning:** "return a promise from a listener" is **Chrome 148+, gradual rollout** (and disabled when a devtools_page is present). Keep `return true` + explicit `sendResponse` as the portable pattern. The throw/reject→sender-rejects behavior is **Chrome 146+**, also gradual rollout.
3. **Sourcing precision (no substance change):** Claim 4's "no DOM/window, use self/importScripts" belongs to the SW-basics page, not the lifecycle page. Claim 6's "extension disabled until re-approved on permission increase" belongs to the "Updating permissions" page. Claim 10's "service worker DevTools link" + "content-script logs in host page DevTools" belong to the "Debugging extensions" page. All accurate; just attribute correctly.
4. **Calibration:** Claims 9 and 11 are correctly NOT fully official — Shadow-DOM/MutationObserver/SPA behavior (9) and the x.com `ct0`/Bearer/GraphQL request shape (11) are engineering/community knowledge. Their "medium" confidence labels are appropriate; the synthesis should not present these as Chrome-doc-backed facts.
