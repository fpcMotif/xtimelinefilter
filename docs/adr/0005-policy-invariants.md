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

## Amendment 2026-07-29 — durable capture of posts the user filed, and export of their own data

Invariant 3's "no scraping beyond the transient author info needed for the requested action" was written when every read was transient: assignment reads an author, acts, and forgets. Folders (ADR-0013) make one read durable, so the invariant is extended rather than bent.

When the user explicitly files a post into a Folder, Lasso may keep a **durable capture** of that post — its status id, permalink, author, text, media URL references and posted-at — in the user's own local database. Three limits keep this inside the original intent: the capture is of a post the user chose to keep, never of the feed at large; it happens on an explicit gesture, never autonomously or in the background; and it records URL references only, downloading no media bytes.

The same extension covers **export of the user's own data**: a user-configured Destination (their Convex deployment, Notion database or Airtable table) may receive the Saved Posts they filed. It is off until configured, carries only what the user is told it carries before enabling it, and is one-way and never load-bearing.

Unchanged: no third-party X credentials, no reading of other users' data beyond the public content of a post the user filed, and no autonomous collection of any kind.

## Amendment 2026-07-22 — explicit GraphQL exception

The original no-scraping rule remains the default. The opt-in GraphQL strategy is its narrow exception.

When GraphQL is selected, the content script may fetch X's page HTML and public JavaScript bundles to read current operation IDs for the three supported operations. Results are cached for seven days. A GraphQL endpoint 404 forces one refresh and one retry; then the action fails visibly.

The extension does not observe or replay X requests, bridge MAIN-world network traffic, derive `x-client-transaction-id`, or run this work without a user-requested assignment. Static IDs remain fallback seeds. Settings discloses the bundle parsing before opt-in.
