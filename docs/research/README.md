# Research index — Lasso (docs-first)

Produced by a 13-agent research workflow (6 tracks × research + adversarial verification + architect synthesis), 2026-06-07. Each note cites primary sources; verification notes record what was confirmed / refuted / left uncertain.

| # | Note | Covers |
|---|---|---|
| 01 | [chrome-mv3](01-chrome-mv3.md) | MV3 manifest, content_scripts, scripting API, SW lifecycle, messaging, permissions, storage, CSP, network-request origins |
| 02 | [auth-page-context](02-auth-page-context.md) | Reading `ct0`/bearer; why same-origin content-script fetch carries the session; header set |
| 03 | [tweet-extraction](03-tweet-extraction.md) | x.com timeline DOM, selectors, tweet-variant handling, MutationObserver, `rest_id` availability |
| 04 | [x-lists-backends](04-x-lists-backends.md) | GraphQL ListAddMember/UserByScreenName/list-ownership shapes; DOM "Add to List" flow; query-id drift; policy |
| 05 | [reference-repo](05-reference-repo.md) | Study of `reference/easy-twitter-lists` + `reference/create-chrome-ext` — copy/avoid |
| 06 | [tdd-testing](06-tdd-testing.md) | Vitest + happy-dom, chrome.* mocks, fetch mocks, Preact testing, Playwright E2E |

Verification passes: [verify-01](verify-01-chrome-mv3.md) · [verify-04](verify-04-x-lists-backends.md) · [verify-06](verify-06-tdd-testing.md) · [verify-reference](verify-reference-repo-hunt.md)

## Cloned references (`reference/`)
- **`easy-twitter-lists`** — a real X-list extension. **Copy:** list-catalog + membership read flow, conventions. **Avoid:** SW+`webRequest` auth routing (we use same-origin content-script fetch), `innerHTML` UI injection, un-throttled error-swallowing POSTs.
- **`create-chrome-ext` / `template-preact-ts`** — MV3 + Vite + `@crxjs` + Preact + TS skeleton. **Copy:** `vite.config` (`crx({manifest}) + preact()`), `defineManifest`, ESM `service_worker`. **Change:** scope `content_scripts.matches` to x.com/twitter.com (not the wildcard default).

> Full machine-readable synthesis (blueprint, mermaid, boundaries, risks, gaps) is the workflow result; the human-facing version lives in [`../blueprint/2026-06-07-lasso-blueprint.md`](../blueprint/2026-06-07-lasso-blueprint.md).
