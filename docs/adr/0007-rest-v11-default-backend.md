# ADR-0007 — REST v1.1 is the default backend; DOM automation and GraphQL are the alternates

Status: Accepted · 2026-06-11 · Refines ADR-0001

## Context
ADR-0001 set DOM automation as the default backend and named two strategies (DOM + GraphQL). In implementation a third strategy was added and made the default: `RestXListApi`, which uses X's stable **v1.1 REST** endpoints (`lists/members/create.json`, `mutes/users/create.json`, …) with the user's own same-origin session. Live verification found the v1.1 path is locale-independent, needs no DOM driving (so it does not break on an X redesign) and no GraphQL query-id drift, and adds members by `screen_name` (no id resolution). The code shipped `DEFAULT_SETTINGS.backend = "rest"` while PRD/CONTEXT still read "DOM-default" — and the Settings disclosure (product story beat 9) puts this exact choice in front of the user, so the docs and the default had to be reconciled before that copy could ship without lying.

## Decision
Make **`rest` the default** `XListApi` strategy. Keep **`dom`** (sanctioned UI automation — the most conservative, what you could click yourself) and **`graphql`** (fastest, private endpoints, opt-in) as the two alternates, selectable in Settings under "How Lasso talks to X". The factory order is `graphql → dom → rest` (rest is the fallthrough default). All three implement the same interface and share the contract test.

The Settings disclosure copy (verbatim, story beat 9):
- **Drive X's own menus** — slow, but uses only what you could click yourself (`dom`)
- **X's public REST endpoints** — fast, same calls X's site makes (`rest`, default)
- **GraphQL** — fastest; uses X's private endpoints and may break or be frowned upon. Opt in deliberately. (`graphql`)

## Consequences
- The default works out of the box, survives X redesigns, and is locale-proof — the best default UX within the policy invariants (ADR-0005 still applies to all three backends).
- ADR-0001's "DOM is the default" is superseded on the *default* only; its strategy-pattern seam and GraphQL-opt-in framing stand.
- PRD/CONTEXT updated to say "REST v1.1 default; DOM + GraphQL alternates."
