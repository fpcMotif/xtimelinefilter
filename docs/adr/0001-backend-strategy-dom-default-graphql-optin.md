# ADR-0001 — Two isolated backends: DOM automation (default) + GraphQL (opt-in); no API v2

Status: Superseded on the default by ADR-0007 · 2026-06-07

## Context
Adding an account to an X List can be done three ways: the official paid X API v2 (OAuth), the internal `/i/api/graphql` endpoints the web app uses, or by automating the sanctioned web UI. The user rejected API v2 (cost) and asked for both GraphQL and DOM automation while respecting X's official policy. Research found: internal GraphQL queryIds/features/bearer rotate every ~2–4 weeks, `x-client-transaction-id` is increasingly enforced and cannot be hardcoded, and a 2026-03 X-Corp DMCA enforces against reverse-engineering exactly these mechanisms.

## Decision
Define one mutation-only `XListApi` interface. The original decision shipped `DomXListApi` as its default and `GraphqlXListApi` as an **explicit opt-in**, with an in-UI policy disclosure. ADR-0007 now makes REST the default; DOM and GraphQL remain alternates. A factory selects the backend from settings; a shared contract test covers them. List discovery is separate. API v2 + OAuth remains the only fully-compliant future strategy.

## Consequences
- Lowest-risk path works out of the box; power users can opt into speed.
- The mutation seam is the project's main extensibility point (add API-v2 later without touching UI/actions).
- GraphQL drift is explicit and failure remains typed and visible. No MAIN-world observation crosses this boundary without a reviewed threat model.

## Amendment 2026-07-22 — GraphQL operation IDs

ADR-0004's runtime resolver supersedes the original static-only rule. Static IDs remain fallback seeds. The opt-in disclosure now names bundle parsing.

## Amendment 2026-07-22 — DOM language contract

The DOM adapter has no safe locale-independent selector for X's Lists menu item. It runs only when the document language is English (or absent in test fixtures); another declared language fails before it clicks the caret. Users can switch X to English or choose REST or GraphQL.
