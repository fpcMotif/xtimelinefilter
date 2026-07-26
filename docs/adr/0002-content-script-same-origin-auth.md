# ADR-0002 — Authenticated x.com calls run in the content script (same-origin), not the service worker

Status: Accepted · 2026-06-07 · Overrides the `easy-twitter-lists` reference pattern.

## Context
The reference extension routes X API calls through the service worker, capturing `authorization`/`x-csrf-token` via `chrome.webRequest.onSendHeaders` and reading cookies via `chrome.cookies`. Research (tracks 01, 02; verify-01) established that an MV3 service-worker `fetch` runs from the `chrome-extension://` origin: it is cross-origin to x.com and will **not** attach x.com's first-party SameSite auth cookies even with `host_permissions`. The SW is also non-persistent (dies ~30s idle), so any cached tokens/state are lost.

## Decision
Route authenticated x.com fetches through the content script, the intended same-origin request path. It reads `ct0` from `document.cookie` for `x-csrf-token`; it never reads HttpOnly `auth_token`. Do not claim cookie attachment or authenticated mutation success until live proof exists. No `chrome.cookies`, no `webRequest`, no SW fetch. The SW owns browser-data semantics: install handling, document-scoped badges, serialized storage work, and Privacy clear. It holds no X tokens. Its migration tombstone blocks cleared legacy settings. `webNavigation` supplies document identity so an old page cannot restore a badge; no browsing history is stored or sent.

## Consequences
- Fewer permissions (no `cookies`, no `webRequest`) → lighter install warning, smaller attack surface.
- Avoids header-sniffing races and SW credential lifetime.
- A live `ListAddMember` must prove that the request carries authenticated X state. This remains open.
