# ADR-0001 — Two isolated backends: DOM automation (default) + GraphQL (opt-in); no API v2

Status: Superseded on the default by ADR-0007 · 2026-06-07

## Context
Adding an account to an X List can be done three ways: the official paid X API v2 (OAuth), the internal `/i/api/graphql` endpoints the web app uses, or by automating the sanctioned web UI. The user rejected API v2 (cost) and asked for both GraphQL and DOM automation while respecting X's official policy. Research found: internal GraphQL queryIds/features/bearer rotate every ~2–4 weeks, `x-client-transaction-id` is increasingly enforced and cannot be hardcoded, and a 2026-03 X-Corp DMCA enforces against reverse-engineering exactly these mechanisms.

## Decision
Define one mutation-only `XListApi` interface. The original decision shipped `DomXListApi` as its default and `GraphqlXListApi` as an **explicit opt-in**, with an in-UI policy disclosure. ADR-0007 now makes REST the default; DOM and GraphQL remain alternates. A factory selects the backend from settings; a shared contract test covers them. List discovery is separate. API v2 + OAuth remains the only fully-compliant future strategy.

## Consequences
- Lowest-risk path works out of the box; power users can opt into speed.
- The mutation seam is the project's main extensibility point (add API-v2 later without touching UI/actions).
- GraphQL drift is explicit: a static config keeps query IDs/features in one file. A rotated ID fails typed and visibly; it is updated only after live verification. No MAIN-world observation crosses this boundary without a reviewed threat model.
