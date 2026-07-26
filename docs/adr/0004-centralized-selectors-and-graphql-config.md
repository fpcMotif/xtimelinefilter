# ADR-0004 — Localize drift-prone hooks by capability; centralize GraphQL config

Status: Accepted · amended 2026-07-26

## Context
The two most fragile surfaces are x.com DOM selectors and GraphQL queryIds/`features`. Scattering one capability's hooks is costly. Putting every capability in one selector table couples unrelated changes.

## Decision
- **`content/selectors.ts`** owns shared timeline-reading hooks. Capability-private hooks stay with their deep module: `packages/x-client/dom-page-driver.ts` owns the Lists dialog; `packages/tweet-actions/actions.ts` owns one-tweet actions. Content injects author-caret lookup and synthetic Escape dispatch. Prefer role + visible text over deep DOM chains. Save real HTML fixtures as the regression contract.
- **`packages/x-client/graphql-config.ts`** owns an atomic fallback catalog: each op has its query ID, `features`, and optional `fieldToggles`. **`packages/x-client/graphql-ops.ts`** may replace IDs only when parsed metadata has the same feature and toggle names. It caches the full catalog for seven days. GraphQL is explicit opt-in. A missing endpoint or required-metadata 400 refreshes once, retries only when the catalog changed, then fails typed and visibly. Do not bridge MAIN-world fetch/XHR observations without a reviewed threat model.

## Consequences
- DOM drift stays local to the owning capability. GraphQL rotation is normally absorbed by the resolver; parser or fallback changes stay inside `x-client`.
- Fixtures pin current DOM/response shapes; verification flagged the dialog internals as needing a live DevTools check before shipping the DOM backend.

## Amendment 2026-07-19 — runtime query-id resolution
All three ops rotated at once and adds silently 404'd:

| op | rotated id | live id (verified 2026-07-19) |
|---|---|---|
| ListAddMember | `P4_AWHREi9pjC9G4_C5OFw` | `yhAkn9q5qaSCxPg_fpykDw` |
| ListRemoveMember | `cYUas2BWBcZHvksAtTMOlw` | `c2IzeyWiwaQBkFs2VV_vSA` |
| UserByScreenName | `sLVLhk0bGj3MVFEKTdax1w` | `2qvSHpkWTMS9i0zJAwDNiA` |

Live verification path: the x.com HTML embeds an inline webpack runtime whose chunk map (`p.u=e=></>` shape, exponent numeric keys like `9e3`) locates `main.*.js` (UserByScreenName today) and `bundle.LoggedInMain.*.js` (the list mutations today); op literals `{queryId,operationName,operationType,metadata}` are parsed straight from the bundle text.

`packages/x-client/graphql-ops.ts` now performs this scrape at runtime (chrome.storage-cached, 7-day TTL). It accepts only balanced objects directly assigned as webpack `identifier.exports`, requires each op's expected query/mutation type, and rejects conflicting duplicate descriptors. IDs and metadata names were observed 2026-07-22. Bundles expose names, not boolean values; reviewed static booleans remain the fallback. Compatible ID rotations are normally absorbed by the resolver. The cache stores the full v2 catalog; v1 stays clear-only. The MAIN-world bridging prohibition is unchanged — the resolver reads public bundle text via ordinary same-origin fetch.
