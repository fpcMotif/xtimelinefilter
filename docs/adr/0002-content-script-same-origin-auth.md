# ADR-0002 — Authenticated x.com calls run in the content script (same-origin), not the service worker

Status: Accepted · 2026-06-07 · Overrides the `easy-twitter-lists` reference pattern.

## Context
The reference extension routes X API calls through the service worker, capturing `authorization`/`x-csrf-token` via `chrome.webRequest.onSendHeaders` and reading cookies via `chrome.cookies`. Research (tracks 01, 02; verify-01) established that an MV3 service-worker `fetch` runs from the `chrome-extension://` origin: it is cross-origin to x.com and will **not** attach x.com's first-party SameSite auth cookies even with `host_permissions`. The SW is also non-persistent (dies ~30s idle), so any cached tokens/state are lost.

## Decision
Make **all authenticated x.com fetches from the content script**, which executes in the page's same-origin network context — the session cookies (HttpOnly `auth_token`) and `ct0` attach automatically; `ct0` is read from `document.cookie` for the `x-csrf-token` header. No `chrome.cookies`, no `webRequest`, no SW fetch. The SW stays minimal (settings/storage/orchestration only), holds no tokens and no long-lived state, and uses the portable `return true` + `sendResponse` messaging pattern.

## Consequences
- Fewer permissions (no `cookies`, no `webRequest`) → lighter install warning, smaller attack surface.
- Simpler, more robust auth (no header sniffing race, no SW lifetime concerns).
- Must verify empirically against a live `ListAddMember` that same-origin auth carries through (listed as an open empirical check).
