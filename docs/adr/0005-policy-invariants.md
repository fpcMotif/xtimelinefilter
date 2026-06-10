# ADR-0005 — Policy invariants: assistive, human-paced, user's-own-data only

Status: Accepted · 2026-06-07 · Direct response to "do not violate X official policy".

## Context
Internal `/i/api/graphql` endpoints are not a published interface; X's ToS bans accessing the service outside published interfaces and scraping without consent, and a 2026-03 X-Corp DMCA enforces against reverse-engineering client keys / `x-client-transaction-id` / GraphQL scraping. Bulk assignment can also trip anti-abuse (HTTP 429 code 88).

## Decision — invariants enforced in BOTH backends and the orchestrator
1. **Explicit user gesture only** — one gesture → one run. No autonomous/background actions, no self-draining queues.
2. **Human-paced** — injected `sleep` + jitter between adds; on `rate-limited`, read `x-rate-limit-reset` and **STOP** the run (no retry-spam).
3. **User's own session, own data** — no third-party credentials; no scraping of other users beyond the transient author info needed to perform the requested action; no off-device redistribution; local-only cache of the user's own Lists.
4. **DOM automation is the conservative default** (X's own client supplies bearer/queryId/transaction-id). GraphQL is opt-in behind an in-UI disclosure.
5. **Idempotent** — `already-member` is success, never retried.

## Consequences
- The product's bulk differentiator is delivered within conservative, assistive limits.
- The fully-compliant official API v2 path is reserved as a future `XListApi` strategy (ADR-0001).
