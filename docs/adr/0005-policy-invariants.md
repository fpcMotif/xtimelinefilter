# ADR-0005 — Policy invariants: assistive, human-paced, user's-own-data only

Status: Accepted · 2026-06-07 · Direct response to "do not violate X official policy".

## Context
Internal `/i/api/graphql` endpoints are not a published interface; X's ToS bans accessing the service outside published interfaces and scraping without consent, and a 2026-03 X-Corp DMCA enforces against reverse-engineering client keys / `x-client-transaction-id` / GraphQL scraping. Bulk assignment can also trip anti-abuse (HTTP 429 code 88).

## Decision — invariants enforced in BOTH backends and the orchestrator
1. **Explicit user gesture only** — one gesture → one run. No autonomous/background actions, no self-draining queues.
2. **Human-paced** — injected `sleep` + jitter between adds; on `rate-limited`, read `x-rate-limit-reset` and **STOP** the run (no retry-spam).
3. **User's own session, own data** — no third-party X credentials; no scraping beyond the transient author info needed for the requested action. The optional user-configured Mirror sends an Owner/List catalog, membership snapshots, assignment audit events, and its device key to the user's Convex deployment. X session credentials stay browser-side.
4. **REST is the current default** mutation strategy. It calls undocumented web v1.1 endpoints that may change. DOM automation is the conservative alternate; GraphQL is opt-in behind an in-UI disclosure. List discovery stays separate.
5. **Idempotent** — `already-member` is success, never retried.

## Consequences
- The product's bulk differentiator is delivered within conservative, assistive limits.
- The fully-compliant official API v2 path is reserved as a future `XListApi` strategy (ADR-0001).

## Amendment 2026-07-22 — explicit GraphQL exception

The original no-scraping rule remains the default. The opt-in GraphQL strategy is its narrow exception.

When GraphQL is selected, the content script may fetch X's page HTML and public JavaScript bundles to read current operation IDs for the three supported operations. Results are cached for seven days. A GraphQL endpoint 404 forces one refresh and one retry; then the action fails visibly.

The extension does not observe or replay X requests, bridge MAIN-world network traffic, derive `x-client-transaction-id`, or run this work without a user-requested assignment. Static IDs remain fallback seeds. Settings discloses the bundle parsing before opt-in.
