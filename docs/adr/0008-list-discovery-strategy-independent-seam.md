# ADR-0008 — List discovery is a strategy-independent seam (fixed REST), not a Backend capability

Status: Accepted · 2026-07-16 · Amends ADR-0001 and ADR-0007

## Context
ADR-0001/0007 framed `XListApi` as one interface with interchangeable backends. In
practice the interface carried a `getLists` method the backends could not honor equally:

- Production never called `backend.getLists()` — `content/main.tsx` loaded owned Lists
  directly through the v1.1 REST ownerships endpoint, regardless of the selected backend.
- `RestXListApi.getLists` worked; `DomXListApi.getLists` used the List *name* as its id
  (there are no ids in the DOM dialog); `GraphqlXListApi.getLists` threw "not implemented".
- The shared contract test therefore excluded REST and only exercised `addMember` — it
  could not run against `getLists` because two of three backends could not satisfy it.

So the interchangeable seam was *mutation*; discovery only looked like a backend concern.
Discovery also carried behavior that was scattered across callers: caching (`list-cache`),
cache-first display + silent refresh (inside `PickerController`), best-effort "already in"
membership, and default-List lookup (inside the content `Controller`).

## Decision
Split the two concerns:

1. **`XListApi` is mutation-only** — `addMember`/`removeMember`, the capabilities every
   backend honors. `getLists` and `resolveUserId` leave the interface (`resolveUserId`
   stays a private detail of `GraphqlXListApi`, which needs a numeric id). The contract
   test now runs REST + DOM + GraphQL against add **and** remove.
2. **List discovery is its own module** — `core/list-discovery.ts` exposes a small
   `ListDiscovery` seam (`ownedLists` / `refresh` / `membership`) and owns loading,
   local owned-List caching, cache-first + silent refresh, and best-effort membership.
   It always loads through the stable v1.1 REST ownerships path **independent of the
   selected mutation backend**. It surfaces only product-relevant failure kinds
   (`auth | rate-limited | unknown`, with a reset time for rate limits) via
   `ListDiscoveryError`; transport specifics stay inside the module.

Callers depend on Lists, not on fetch/auth/cache/refresh mechanics: the `PickerController`
and content `Controller` take a `ListDiscovery`; neither sees `force` flags or a cache.
Settings discloses the fixed REST discovery path under all three mutation choices.

## Consequences
- The Backend interface is honest: the contract test exercises exactly what production
  mutates, and no adapter has to fake `getLists`.
- One deep module owns discovery; deleting it would redistribute fetch, auth, parsing,
  failure, caching, and refresh knowledge back into the Picker and Controller.
- DOM/GraphQL users still get a fully populated picker (owned Lists load via REST); DOM
  mutation continues to match Lists by name, which the REST-loaded names supply.
- Policy invariants (ADR-0005) and content-script same-origin auth (ADR-0002) are
  unchanged — discovery fetches run in the content script and cache only owned Lists locally.
- A future GraphQL/API-v2 discovery source, if ever wanted, is added behind `ListDiscovery`,
  not by resurrecting `XListApi.getLists`.
