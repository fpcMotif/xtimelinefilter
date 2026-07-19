# ADR-0007 — REST v1.1 is the default backend; DOM automation and GraphQL are the alternates

Status: Accepted · 2026-06-11 · Refines ADR-0001

## Context
ADR-0001 set DOM automation as the default backend and named two strategies (DOM + GraphQL). In implementation a third strategy was added and made the current default: `RestXListApi`, which calls X's undocumented web **v1.1** endpoints (`lists/members/create.json`, `mutes/users/create.json`, …) with the user's own same-origin session. Those endpoints are not X's developer API and may change. They avoid DOM driving and GraphQL query-id drift, and add members by `screen_name` (no id resolution), but that is not a stability promise. The code shipped `DEFAULT_SETTINGS.backend = "rest"` while PRD/CONTEXT still read "DOM-default" — and the Settings disclosure (product story beat 9) puts this exact choice in front of the user, so the docs and the default had to be reconciled before that copy could ship without lying.

## Decision
Make **`rest` the current default** mutation-only `XListApi` strategy. Keep **`dom`** (sanctioned UI automation — the conservative alternate, using only what you could click yourself; it requires a currently visible post and is not fully Author-addressable) and **`graphql`** (fastest, private endpoints, opt-in) as the two alternates, selectable in Settings under "How Lasso talks to X". The factory order is `graphql → dom → rest` (rest is the fallthrough default). All three implement the same mutation interface and share the contract test. List discovery is a separate `lists-provider` concern; it also calls X's undocumented web v1.1 endpoints and does not vary with the selected mutation backend.

The Settings disclosure copy (verbatim, story beat 9):
- **Drive X's own menus** — slow; requires a currently visible post and uses only what you could click yourself (`dom`)
- **X's web REST endpoints** — fast, same calls X's site makes; not X's developer API (`rest`, default)
- **GraphQL** — fastest; uses X's private endpoints and may break or be frowned upon. Opt in deliberately. (`graphql`)

## Consequences
- The default avoids DOM driving and GraphQL query IDs, but relies on undocumented web endpoints that may change. ADR-0005 still applies to all three backends.
- ADR-0001's "DOM is the default" is superseded on the *default* only; its strategy-pattern seam and GraphQL-opt-in framing stand.
- CONTEXT records: undocumented web v1.1 REST is the current default; DOM and GraphQL are alternates; list discovery is separate.
