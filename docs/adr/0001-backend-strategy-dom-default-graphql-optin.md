# ADR-0001 — Two isolated backends: DOM automation (default) + GraphQL (opt-in); no API v2

Status: Accepted · 2026-06-07 · Supersedes the first-pass "internal GraphQL default".

## Context
Adding an account to an X List can be done three ways: the official paid X API v2 (OAuth), the internal `/i/api/graphql` endpoints the web app uses, or by automating the sanctioned web UI. The user rejected API v2 (cost) and asked for both GraphQL and DOM automation while respecting X's official policy. Research found: internal GraphQL queryIds/features/bearer rotate every ~2–4 weeks, `x-client-transaction-id` is increasingly enforced and cannot be hardcoded, and a 2026-03 X-Corp DMCA enforces against reverse-engineering exactly these mechanisms.

## Decision
Define one `XListApi` interface and ship **two interchangeable strategies**: `DomXListApi` (the **default**, drives the sanctioned UI; needs no bearer/queryId/transaction-id) and `GraphqlXListApi` (**opt-in**, faster, with an in-UI policy disclosure). A factory selects the active backend from settings; a shared **contract test** runs against both. API v2 + OAuth is documented as the only fully-compliant path and reserved as a future strategy.

## Consequences
- Lowest-risk path works out of the box; power users can opt into speed.
- The seam is the project's main extensibility point (add API-v2 later without touching UI/actions).
- GraphQL drift is contained: queryIds/features live in one config module with a runtime sniffer and snapshot seed.
