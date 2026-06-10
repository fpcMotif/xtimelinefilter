# 05 — Reference Repos for `lasso-x-list-assigner`

Research date: 2026-06-07
Project under study: `lasso-x-list-assigner` — "Assign tweet authors to your X Lists in bulk, from the timeline."
Current stack (from `/Users/martinfan/devv/xtimelinefilter/package.json`): **Preact + @preact/signals + Vite + TypeScript + Vitest + happy-dom + Biome**, `@types/chrome`. MV3 target. No `manifest`, no `vite.config.ts`, no build glue exists yet — only `src/core/selection-store.ts`. So we need references for (A) the **X List-curation behavior** and (B) the **MV3 + Vite + Preact + TS build skeleton**.

---

## Chosen references (2)

| # | Repo | Category | Stars | Last push | Size | Why chosen |
|---|------|----------|-------|-----------|------|------------|
| A | **`kjhq/easy-twitter-lists`** | X list curation | 0 | 2026-05-10 | ~10 KB | Smallest possible end-to-end reference for the *exact* feature: capture X auth headers, list a user's owned Lists, check membership, add/remove a user from a List. Plain MV3 JS, no build step — pure signal of the X API contract. |
| B | **`guocaoyi/create-chrome-ext` → `template-preact-ts`** | MV3 + Vite + TS template | 2117 (repo) | 2025-08-23 | (monorepo) | The `template-preact-ts` sub-template is an *exact stack match*: Preact + Vite + `@crxjs/vite-plugin` + TS + MV3 via `defineManifest`. Canonical, widely-used scaffolder (`npm create chrome-ext`). |

Local clone paths (depth-1):
- `/Users/martinfan/devv/xtimelinefilter/reference/easy-twitter-lists/`
- `/Users/martinfan/devv/xtimelinefilter/reference/create-chrome-ext/` (relevant sub-dir: `template-preact-ts/`)

Authoritative companion (NOT cloned, very large, MV2+MV3, plain JS): **`insin/control-panel-for-twitter`** (2535★, pushed 2026-05-17) — best real-world reference for *robust X DOM observation & SPA navigation handling at scale*. Cite for MutationObserver/locale patterns; do not copy wholesale (it's huge, 27 MB, framework-less).

---

## Candidates evaluated (3–5 per category)

### Category A — X List curation extensions
| Repo | Stars | Push | MV3? | Verdict |
|------|-------|------|------|---------|
| `kjhq/easy-twitter-lists` | 0 | 2026-05-10 | ✅ MV3 | **CHOSEN.** Tiny, current, exact feature. Plain JS but that's a *plus* for reading the X API contract. |
| `naman-makkar/twitter-list-chrome-extension` | 0 | 2025-04-22 | ✅ MV3 | Runner-up. "Quick Add" popup + content script, but 3.5 MB repo and less complete (no membership check / header-capture story as clean). |
| `deanmalan/twitter-add-to-lists-extension` | 0 | 2016-01-29 | ❌ (MV2-era, pre-x.com) | Rejected — ancient, twitter.com DOM, dead API. |
| `insin/control-panel-for-twitter` | 2535 | 2026-05-17 | ✅ MV3+MV2 | Not a "list curation" tool per se; it's a feature-toggle/UI-tweak extension. Kept as a *DOM-handling* reference only. |
| `serd/tweep-list` | 2 | 2020-05-20 | ❌ MV2 | Rejected — old, avatar-menu only, no add-to-list API. |

X-list-curation extensions are overwhelmingly *zero-star personal projects* (the GraphQL API is unofficial/undocumented, so few are maintained). `easy-twitter-lists` is the freshest and cleanest end-to-end example found.

### Category B — MV3 + Vite + TS extension templates
| Repo | Stars | Push | Plugin | Verdict |
|------|-------|------|--------|---------|
| `crxjs/chrome-extension-tools` (`@crxjs/vite-plugin`) | 4097 | 2026-06-01 | (the plugin itself) | The underlying plugin. Authoritative; docs at crxjs.dev. Use as source-of-truth, not a template. |
| `guocaoyi/create-chrome-ext` (`template-preact-ts`) | 2117 | 2025-08-23 | `@crxjs/vite-plugin@2.0.0-beta` | **CHOSEN.** Has a Preact-TS sub-template — perfect stack match. Multi-framework scaffolder, well-known. |
| `yosevu/react-chrome-extension-template` | 248 | 2026-03-07 | crxjs | React, not Preact. Good MV3 ref but stack mismatch. |
| `rezasohrabi/chrome-ext-starter` | 161 | 2026-04-07 | crxjs + React + Tailwind | React/Tailwind heavy; mismatch. |
| `aklinker1/vite-plugin-web-extension` | 841 | 2026-04-06 | (alt plugin) | Strong *alternative* bundler (Vite-native, cross-browser, uses `webextension-polyfill`). Note as fallback if crxjs HMR is troublesome, but project already implies crxjs/Preact path. |
| `samrum/vite-plugin-web-extension` | 355 | 2024-09-26 | (alt plugin) | Another alt; less active. |

`@crxjs/vite-plugin` is the right pick because: (1) it gives true MV3 HMR for content scripts, (2) `defineManifest` keeps the manifest typed and in-sync with `package.json`, (3) it's what the chosen Preact-TS template already uses.

---

## Architecture digest

### A. `easy-twitter-lists` (the X behavior)
Five-file MV3 service worker (concatenated via `importScripts`) + five content-script files. Flow:

```
[X page request] --onSendHeaders--> background_header.js  (capture authorization + x-csrf-token; twid from cookie)
                                          |
                                          v
                              background_capture_lists.js  (GET ListOwnerships GraphQL -> {name: id_str})
content_is_profile.js (MutationObserver waits for data-testid="userActions")
   -> content_add_lists.js  (read memberID from follow button; ask bg for lists + membership in parallel)
       -> content_html.js / content_initalize_list.js (inject "Add to List" dropdown, wire clicks)
           -> click -> background_add_member.js  (POST ListAddMember / ListRemoveMember GraphQL)
```

Key facts the project must replicate:

1. **Auth capture (the crux).** X's internal GraphQL needs a Bearer `authorization` header AND an `x-csrf-token` that must equal the `ct0` cookie. You cannot read these from JS in the page; you sniff them off the user's own in-flight requests:
   - `manifest.json` permissions: `["webRequest", "scripting", "activeTab", "cookies"]`, host_permissions `["https://x.com/*"]`.
   - `chrome.webRequest.onSendHeaders.addListener(fn, {urls:["*://x.com/*"]}, ["requestHeaders"])` — capture `authorization` and `x-csrf-token`.
   - `twid` (which encodes the logged-in user id, `u%3D<id>`) is read via `chrome.cookies.get({url:"https://x.com", name:"twid"})`.
   - `credentials: "include"` on every `fetch` so the `ct0`/auth cookies ride along; the `x-csrf-token` header must match the `ct0` cookie or X returns 403.

2. **List ownerships endpoint** (read user's own Lists):
   `GET https://x.com/i/api/graphql/<qid>/ListOwnerships?variables=...&features=...`
   - `variables` = `{userId, isListMemberTargetUserId, count:20}`.
   - Response path (brittle!): `data.user.result.timeline.timeline.instructions[3].entries[].content.itemContent.list.{name,id_str}`.

3. **Membership check** (which Lists already contain a user) uses the *legacy v1.1* REST endpoint, simpler than GraphQL:
   `GET https://x.com/i/api/1.1/lists/memberships.json?...&user_id=<id>&count=1000&filter_to_owned_lists=true` → `{lists:[{name,...}]}`.

4. **Add / remove member** (GraphQL POST):
   - Add: `POST https://x.com/i/api/graphql/<qid>/ListAddMember`
   - Remove: `POST https://x.com/i/api/graphql/<qid>/ListRemoveMember`
   - Body: `{variables:{listId:String, userId:String}, features:{...}}`. `listId`/`userId` MUST be strings.

5. **DOM hooks** (selectors observed in May 2026):
   - Author/profile action button: `button[data-testid="userActions"]`.
   - The target user's numeric id is parsed from the follow button: `button[data-testid*="follow"]` → `getAttribute("data-testid").split("-")[0]` yields `<userId>-follow`. (For *timeline* bulk-assign — this project's actual use case — the author id lives in the tweet's `User` entity in the timeline GraphQL response; the follow-button trick is profile-page-only.)
   - SPA-safe injection via a `MutationObserver` on `document.documentElement` with `{childList, subtree, attributes, attributeFilter:[attr]}` plus a `WeakSet` dedupe to avoid re-injecting.

### B. `create-chrome-ext / template-preact-ts` (the build skeleton)
- `vite.config.ts`: `plugins: [crx({ manifest }), preact()]`; `build.outDir: 'build'`, `legacy.skipWebSocketTokenCheck: true` (needed for crxjs HMR).
- `src/manifest.ts`: `defineManifest({...})` — `manifest_version:3`, pulls `name/version/description` from `package.json`, declares `background.service_worker: 'src/background/index.ts'` with `type:'module'`, `content_scripts:[{matches, js:['src/contentScript/index.ts']}]`, plus popup/options/sidepanel. crxjs rewrites these source paths to hashed build outputs automatically.
- `src/background/index.ts`: ESM service worker; uses `chrome.runtime.onMessage`.
- `src/popup/index.ts`: `render(createElement(Popup,null), document.getElementById('app'))` — Preact mount pattern.
- `tsconfig.json`: `jsx:"preserve"`, `jsxFactory:"h"`, `jsxFragmentFactory:"Fragment"`, `moduleResolution:"Node"`, `strict:true`, `isolatedModules:true`, `noEmit:true`. (Project's own tsconfig should mirror the JSX settings; with `@preact/preset-vite` you can alternatively use `jsx:"react-jsx"` + `jsxImportSource:"preact"`.)
- Build: `"build": "tsc && vite build"`; dev: `"dev": "vite"`.

---

## Patterns to COPY

1. **Sniff auth from the user's own requests** with `chrome.webRequest.onSendHeaders` (`authorization`, `x-csrf-token`); read `twid`/`ct0` via `chrome.cookies.get`. Do all `fetch` to `x.com/i/api/*` from the **service worker** (or an injected page-context script) with `credentials:"include"`. (`reference/easy-twitter-lists/background_header.js`, `background_capture_lists.js`.)
2. **Centralize X API calls in the background/service worker**, content script talks to it via `chrome.runtime.sendMessage` and gets typed responses. Keeps tokens out of the page DOM. (`background_add_member.js`, `background_is_member.js`.)
3. **`Promise.all` the "list catalog" + "current membership" fetches** before rendering the assign UI, so the toggle state is correct on first paint. (`content_add_lists.js`.)
4. **`String(listId)` / `String(userId)`** in GraphQL bodies — X rejects numeric ids. (`background_add_member.js`.)
5. **Prefer the v1.1 `lists/memberships.json` endpoint for membership reads** — far simpler/stabler than walking the GraphQL `instructions[]` tree. (`background_is_member.js`.)
6. **MutationObserver + WeakSet dedupe** scoped to `document.documentElement` with an `attributeFilter` to cheaply detect X's SPA re-renders and inject UI exactly once. (`content_is_profile.js`.)
7. **`defineManifest` driven by `package.json`** + `crx({manifest})` + `@preact/preset-vite`, `build.outDir:'build'`, `legacy.skipWebSocketTokenCheck:true`. (`reference/create-chrome-ext/template-preact-ts/{vite.config.ts,src/manifest.ts}`.)
8. **ESM service worker** (`background.service_worker` + `type:"module"`) so the background can `import` shared TS modules — replaces the legacy `importScripts` concatenation that `easy-twitter-lists` uses.

## Anti-patterns to AVOID

1. **Hard-coded GraphQL query-id hashes** (`graphql/fbJc4XYq7m2bA_UBWAj31g/ListAddMember`, the `ListOwnerships` qid, etc.). X rotates these with client builds; they WILL break. Mitigation: capture them dynamically from the page's own outgoing GraphQL requests (extend the `onSendHeaders`/`onBeforeRequest` listener to record `operationName → {queryId, features}`), or scrape `main.*.js`. Do not ship literals. (Seen hard-coded in `background_capture_lists.js`, `background_add_member.js`.)
2. **Hard-coded `userId` literals in `variables`** (`easy-twitter-lists` left a real `userId`/`isListMemberTargetUserId` baked into the `ListOwnerships` URL). Derive `userId` from `twid` at runtime.
3. **Index-based response walking** — `instructions[3].entries` is fragile; X reorders `instructions`. Search instructions by `type`/`entryId` prefix instead of a fixed index. (`background_capture_lists.js`.)
4. **`importScripts(...)` to glue background modules** — works only for plain-JS MV3; in a Vite/crxjs/TS project use real ESM `import` with `service_worker.type:"module"`.
5. **`innerHTML` string injection of UI** (`content_html.js`, `content_add_lists.js`) — XSS-risky and unstyled-by-Shadow; in a Preact project, render into a mounted root (ideally inside a Shadow DOM so X's CSS doesn't leak in/out).
6. **Inline `<style>` with `z-index:2147483647` everywhere** — symptom of fighting X's CSS. Use Shadow DOM encapsulation instead. (`content_html.js`.)
7. **Sequential single-member POSTs without throttling** — for *bulk* assignment (this project's whole point) you must rate-limit/queue and handle 429/403; `easy-twitter-lists` fires one-off requests with no backoff. Build a queue with retry + jitter.
8. **`content_scripts.matches: ["http://*/*","https://*/*"]`** from the template default — scope to `["https://x.com/*","https://twitter.com/*"]` only.
9. **No error surfacing** — `easy-twitter-lists` swallows errors into `console.error`. For bulk ops, surface per-item success/failure to the UI.

---

## Concrete artifacts (verbatim from clones, May 2026)

- Endpoints:
  - `GET  https://x.com/i/api/graphql/2PPrJxgM_t26Aut95OSoOg/ListOwnerships`
  - `POST https://x.com/i/api/graphql/fbJc4XYq7m2bA_UBWAj31g/ListAddMember`
  - `POST https://x.com/i/api/graphql/QK7JkzeJYfmid2ISB3H1Jw/ListRemoveMember`
  - `GET  https://x.com/i/api/1.1/lists/memberships.json?...&user_id=<id>&count=1000&filter_to_owned_lists=true`
  (query-id hashes are point-in-time; treat as illustrative, not durable.)
- Headers required: `authorization: <Bearer ...>`, `x-csrf-token: <ct0>`, `content-type: application/json`; `credentials:"include"`.
- ListAddMember body shape:
  ```json
  { "variables": { "listId": "<string>", "userId": "<string>" },
    "features": { "responsive_web_graphql_timeline_navigation_enabled": true, "...": true } }
  ```
- Selectors: `button[data-testid="userActions"]`, `button[data-testid*="follow"]` (id = `data-testid.split("-")[0]`).

---

## Sources
- `kjhq/easy-twitter-lists` — https://github.com/kjhq/easy-twitter-lists (files: manifest.json, background_header.js, background_capture_lists.js, background_add_member.js, background_is_member.js, content_*.js)
- `guocaoyi/create-chrome-ext` — https://github.com/guocaoyi/create-chrome-ext (template-preact-ts/{vite.config.ts, src/manifest.ts, tsconfig.json, package.json})
- `insin/control-panel-for-twitter` — https://github.com/insin/control-panel-for-twitter (DOM/SPA handling reference)
- `crxjs/chrome-extension-tools` — https://github.com/crxjs/chrome-extension-tools ; docs https://crxjs.dev/ and https://crxjs.dev/guide/installation/create-crxjs
- `aklinker1/vite-plugin-web-extension` (alt) — https://github.com/aklinker1/vite-plugin-web-extension
- Chrome `webRequest` API — https://developer.chrome.com/docs/extensions/reference/api/webRequest
- Chrome permissions / host_permissions — https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
