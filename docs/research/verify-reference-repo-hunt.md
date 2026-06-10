# Adversarial Verification — Reference Repo Hunt & Deep Study

Date: 2026-06-07. Verifier re-checked each claim against primary/official sources and local code. Default to "uncertain" unless corroborated.

## Tooling note
- `mgrep --web` was quota-exhausted (HTTP 429, monthly limit). Web corroboration done via `curl -sSL` on developer.chrome.com, raw.githubusercontent.com, and `gh api`. Built-in WebSearch not used (project policy).

---

## Claim 1 — easy-twitter-lists captures X auth via webRequest + drives GraphQL/v1.1 — CONFIRMED

Local files re-read and verified line-by-line:

- `manifest.json`: MV3, `permissions:[webRequest, scripting, activeTab, cookies]`, `host_permissions:["https://x.com/*"]`. **MATCHES exactly.**
- `background_header.js`: `chrome.webRequest.onSendHeaders.addListener(captureHeaders, {urls:["*://x.com/*"]}, ["requestHeaders"])` captures `authorization` + `x-csrf-token`; `chrome.cookies.get({url:"https://x.com", name:"twid"})` for twid. **MATCHES.**
- All fetches use `credentials:"include"`. **MATCHES** (capture_lists L12, add_member L35, is_member L9).
- Endpoints:
  - GET `/i/api/graphql/2PPrJxgM_t26Aut95OSoOg/ListOwnerships` (capture_lists L16). **MATCHES.**
  - POST `/i/api/graphql/fbJc4XYq7m2bA_UBWAj31g/ListAddMember` (add_member L9). **MATCHES.**
  - POST `/i/api/graphql/QK7JkzeJYfmid2ISB3H1Jw/ListRemoveMember` (add_member L11). **MATCHES.**
  - GET `/i/api/1.1/lists/memberships.json?...&filter_to_owned_lists=true` (is_member L13; also has cursor=-1, count=1000). **MATCHES.**
- Body shape `{variables:{listId:String,userId:String}, features:{...}}` (add_member L14-28). **MATCHES.**

Caveat: kjhq/easy-twitter-lists has **0 stars** (gh api). "Best small reference" is a subjective judgment; technically it is an accurate, minimal, on-point reference. Subjectivity flagged but technical accuracy confirmed.

Sources: local files; https://github.com/kjhq/easy-twitter-lists

---

## Claim 2 — create-chrome-ext template-preact-ts is an exact build-skeleton match — CONFIRMED (with detail nuances)

- `vite.config.ts`: `plugins:[crx({manifest}), preact()]`, `build.outDir:'build'`, `legacy.skipWebSocketTokenCheck:true`. **MATCHES.** (preact import is `@preact/preset-vite`.)
- `src/manifest.ts`: `defineManifest`, `manifest_version:3`, `background.service_worker:'src/background/index.ts', type:'module'`, `content_scripts.js:['src/contentScript/index.ts']` (TS source paths rewritten by crxjs). **MATCHES.**
- `tsconfig.json`: `jsx:'preserve'`, `jsxFactory:'h'`, `jsxFragmentFactory:'Fragment'`. **MATCHES.**
- "The project currently has no manifest or vite.config at all": **CONFIRMED** — `ls vite.config.* manifest* src/manifest*` all return "No such file or directory"; crxjs / @preact/preset-vite absent from package.json + bun.lock. Project src currently only has `src/core/selection-store.ts` and `src/core/x-client/types.ts`.

Nuance: project package.json already pins preact 10.29.2, @preact/signals, vitest 4, biome, @types/chrome — so the stack is real and the missing glue is precisely the crxjs vite.config + defineManifest, exactly as claimed.

Sources: local template files; https://github.com/guocaoyi/create-chrome-ext (2117 stars, pushed 2025-08-23)

---

## Claim 3 — X auth must be sniffed, not page-read; x-csrf-token must equal ct0 — CONFIRMED (two parts, one external)

### Part A: sniff via onSendHeaders + credentials:include — CONFIRMED
- Chrome docs (https://developer.chrome.com/docs/extensions/reference/api/webRequest):
  - `onSendHeaders` "Fires after all extensions have had a chance to modify the request headers, and presents the final (*) version ... before the headers are sent to the network. This event is informational."
  - CRITICAL distinction the synthesis must keep: the doc's list "headers currently **not provided to the onBeforeSendHeaders event** ... Authorization, Cache-Control, ..." applies to `onBeforeSendHeaders` (the modifiable event), because those are added later by the network stack. `onSendHeaders` presents the *final* headers. X's web app sets the `authorization` bearer + `x-csrf-token` explicitly on its `fetch` calls (application headers, not network-stack-injected), so they ARE visible to `onSendHeaders` with `["requestHeaders"]`. Technique is sound.
- host_permissions for x.com + "webRequest" permission required: confirmed in both webRequest doc ("must declare the webRequest permission ... along with the necessary host permissions") and declare-permissions doc.

### Part B: x-csrf-token == ct0 cookie — CONFIRMED via independent reverse-eng libs (NOT via easy-twitter-lists)
- easy-twitter-lists does **NOT** assert csrf==ct0. It reads `ct0`-equivalent indirectly: it sniffs `x-csrf-token` straight from outgoing headers and reads the `twid` cookie (not ct0). So this sub-claim is NOT demonstrated by the cited reference file.
- Independent corroboration (X double-submit-cookie scheme):
  - twikit `twikit/client/client.py`: `_get_csrf_token()` returns `self.http.cookies.get('ct0')`; then `headers['X-Csrf-Token'] = csrf_token`. (https://raw.githubusercontent.com/d60/twikit/main/twikit/client/client.py)
  - trevorhobenshield/twitter-api-client `twitter/util.py`: `'x-csrf-token': cookies.get('ct0', '')`. (https://raw.githubusercontent.com/trevorhobenshield/twitter-api-client/main/twitter/util.py)
- This project's own `src/core/x-client/types.ts` documents: `csrf: ct0 cookie value, sent as x-csrf-token`.

Verdict: confirmed, but with the correction that the ct0==csrf fact is sourced from twikit / twitter-api-client / this project's types, NOT from background_header.js (which sniffs the header). The sniff-the-header approach in easy-twitter-lists is an equally valid alternative to deriving csrf from ct0.

Sources: webRequest doc, declare-permissions doc, twikit, twitter-api-client, local background_header.js + types.ts

---

## Claim 4 — easy-twitter-lists fragile patterns to NOT copy verbatim — CONFIRMED

All cited fragilities verified in local code:
- Hardcoded GraphQL qids: `2PPrJxgM_t26Aut95OSoOg` (ListOwnerships), `fbJc4XYq7m2bA_UBWAj31g` (ListAddMember), `QK7JkzeJYfmid2ISB3H1Jw` (ListRemoveMember). **CONFIRMED.**
- Baked real ids into ListOwnerships URL: `userId=1530198640207093760`, `isListMemberTargetUserId=5797422`. **CONFIRMED** (capture_lists L16). Note: the synthesis says "bakes a real userId" — there are TWO baked ids (owner userId + a target user id); both are hardcoded.
- Fixed-index response walk `instructions[3].entries` (capture_lists L19, L24). **CONFIRMED.**
- `importScripts(...)` glue in background.js. **CONFIRMED** (single line importScripts of 4 modules).
- UI injection via HTML strings: `userActions.insertAdjacentHTML("beforebegin", html)` (add_lists L42), `dropdownMenuElement.innerHTML = listsHTML` (initalize_list L24), `z-index:2147483647` (content_html.js, 5 occurrences). **CONFIRMED.**

Recommended replacements (capture qids dynamically, derive userId from twid, search instructions by entryId, ESM imports, Preact in Shadow DOM) are sound mitigations; they are best-practice recommendations rather than verifiable facts.

Sources: local capture_lists, add_member, content_html, content_add_lists, content_initalize_list, background.js

---

## Claim 5 — SPA-safe injection: MutationObserver + WeakSet dedupe on documentElement — CONFIRMED (with attribution fix)

- `content_is_profile.js`: `OptimizedButtonObserver` uses `this.found = new WeakSet()`; observes `document.documentElement` with `{childList:true, subtree:true, attributes:true, attributeFilter:['data-testid'], attributeOldValue:false}`; injects once when `button[data-testid="userActions"]` appears (callback -> `addListsTab()`). **CONFIRMED.**
- **Attribution correction:** the numeric user-id parse from `button[data-testid*="follow"]` via `.split("-")[0]` is in `content_add_lists.js` (L21), NOT in `content_is_profile.js`. The synthesis lumps both into content_is_profile.js. Selector is `button[data-testid*="follow"` (note: the source has a typo — missing closing `]` — `document.querySelector('button[data-testid*="follow"')`). Works in practice but is malformed.
- The synthesis's own caveat is correct: follow-button id trick is profile-page only; timeline bulk-assign must get author ids from the timeline GraphQL User entity.
- insin/control-panel-for-twitter confirmed as the larger hardened reference: exists, 2535 stars, pushed 2026-05-17, describes itself as a browser extension for the Twitter timeline. **CONFIRMED as a real, substantial reference.**

Sources: local content_is_profile.js + content_add_lists.js; https://github.com/insin/control-panel-for-twitter

---

## Claim 6 — @crxjs/vite-plugin right choice; aklinker1 viable fallback — CONFIRMED with CORRECTION

- crxjs/chrome-extension-tools: gh api -> 4097 stars, pushed_at 2026-06-01T16:43:58Z, not archived, "Build cross-browser extensions with native HMR and zero-config setup". **Star count + push date MATCH the claim exactly.**
- Template already uses `@crxjs/vite-plugin` (^2.0.0-beta.26) + `defineManifest` synced to package.json. **CONFIRMED.**
- crxjs.dev resolves (HTTP 200). create-crxjs guide https://crxjs.dev/guide/installation/create-crxjs/ resolves (HTTP 200, trailing-slash redirect). **CONFIRMED** that modern scaffolding is create-crxjs.
- aklinker1/vite-plugin-web-extension: gh api -> 841 stars, not archived. **Star count MATCHES.** Vite-native + cross-browser confirmed by description ("Vite plugin for developing Chrome/Web Extensions") and README peer-dep on Vite.

### CORRECTION (important):
aklinker1's README **now leads with a deprecation notice**: "`vite-plugin-web-extension` will soon be deprecated in favor of [WXT](https://wxt.dev), it's successor... If you're starting a new project, I'd recommend you use WXT instead." So calling it "the strongest alternative / viable fallback" is partially stale: the maintainer points new projects to **WXT (wxt.dev)** instead. The synthesis should name **WXT** as the primary non-crxjs fallback, with aklinker1's plugin demoted to maintenance-mode.

Confidence on overall claim: medium->high for the crxjs portion (facts match), but the fallback recommendation needs the WXT correction.

Sources: gh api repos/crxjs/chrome-extension-tools, repos/aklinker1/vite-plugin-web-extension; https://crxjs.dev/; https://crxjs.dev/guide/installation/create-crxjs/; aklinker1 README (raw)

---

## Corrections summary for synthesis
1. Claim 3: ct0==x-csrf-token is corroborated by twikit / twitter-api-client / this project's types.ts — NOT by background_header.js (which sniffs the header directly). Both approaches valid.
2. Claim 3: keep the onBeforeSendHeaders-vs-onSendHeaders distinction explicit — the "Authorization not provided" Chrome note applies to onBeforeSendHeaders, not onSendHeaders.
3. Claim 5: the follow-button id-parse lives in content_add_lists.js (L21), not content_is_profile.js; and the selector string has a missing `]` typo.
4. Claim 4: ListOwnerships URL bakes TWO hardcoded ids (owner userId 1530198640207093760 + target 5797422), not one.
5. Claim 6: aklinker1/vite-plugin-web-extension is now self-deprecated in favor of WXT (wxt.dev); recommend WXT as the primary fallback.
6. Claim 1: kjhq/easy-twitter-lists has 0 stars; "best small reference" is a subjective framing (technical accuracy is fine).
