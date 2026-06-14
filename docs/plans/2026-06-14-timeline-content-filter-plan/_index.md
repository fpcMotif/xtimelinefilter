# Implementation Plan — Timeline Content Filter

- **Design spec:** [../../superpowers/specs/2026-06-14-timeline-content-filter-design.md](../../superpowers/specs/2026-06-14-timeline-content-filter-design.md) (committed `4deb637`)
- **Date:** 2026-06-14
- **Approach:** TDD (Red → Green per feature), one task per file, BDD-scenario-driven.

## Context

Lasso gains a second capability: a client-side **Filter** that narrows the Home / List timeline by content **Facet** (media kind, link destination, language, repost) using a tri-state `off | only | hide` model. It is **display-only** — it never calls X, never acts on X, is never load-bearing for the List-assign flow, fails open, and hides via a **reversible collapse-to-stub** (ADR-0010). Each DOM facet selector must be **verified against live X** before it ships (MISSION.md).

The plan follows the spec's §12 verifiable goals. Pure logic (`core/*`) is built and tested first with happy-dom fixtures; DOM wiring (`content/*`), UI (`ui/*`, Options), integration (`content/main.tsx`), and e2e come after; a final live-DOM verification gate precedes trusting any selector.

### Current state → target state

| Dimension | Current | Target |
|---|---|---|
| Capabilities over a Tweet | List-assign only (Tweet → Author) | + Filter (Tweet → show/hide by Facet) |
| Timeline reading | `tweet-scanner` → overlay injection | same scan also feeds `filter-applier` |
| Selectors | `Selectors` + `DriverSelectors` | + `FacetSelectors` (ADR-0004) |
| Persisted settings | `core/settings` (storage.sync) | + `core/filter-store` (FilterState, myLanguages, linkRules) |
| Shadow-DOM UI | `App` (toolbar/picker/toasts) | + sticky `filter-bar` under the tab strip |
| Options page | backend choice, etc. | + My-languages allowlist + Link rules editors |

## Execution Plan

```yaml
tasks:
  - id: "001"
    subject: "Shared Filter types + FacetSelectors"
    slug: "types-and-selectors"
    type: "setup"
    depends-on: []
  - id: "002"
    subject: "Link classifier — test"
    slug: "link-classifier-test"
    type: "test"
    depends-on: ["001"]
  - id: "003"
    subject: "Link classifier — impl"
    slug: "link-classifier-impl"
    type: "impl"
    depends-on: ["002"]
  - id: "004"
    subject: "Tweet facets — test"
    slug: "tweet-facets-test"
    type: "test"
    depends-on: ["001"]
  - id: "005"
    subject: "Tweet facets — impl"
    slug: "tweet-facets-impl"
    type: "impl"
    depends-on: ["004"]
  - id: "006"
    subject: "Timeline filter decide — test"
    slug: "timeline-filter-test"
    type: "test"
    depends-on: ["001"]
  - id: "007"
    subject: "Timeline filter decide — impl"
    slug: "timeline-filter-impl"
    type: "impl"
    depends-on: ["006", "003"]
  - id: "008"
    subject: "Filter store — test"
    slug: "filter-store-test"
    type: "test"
    depends-on: ["001"]
  - id: "009"
    subject: "Filter store — impl"
    slug: "filter-store-impl"
    type: "impl"
    depends-on: ["008"]
  - id: "010"
    subject: "Filter applier — test"
    slug: "filter-applier-test"
    type: "test"
    depends-on: ["001"]
  - id: "011"
    subject: "Filter applier — impl"
    slug: "filter-applier-impl"
    type: "impl"
    depends-on: ["010", "005", "007", "009"]
  - id: "012"
    subject: "Filter bar UI — test"
    slug: "filter-bar-test"
    type: "test"
    depends-on: ["009"]
  - id: "013"
    subject: "Filter bar UI — impl"
    slug: "filter-bar-impl"
    type: "impl"
    depends-on: ["012"]
  - id: "014"
    subject: "Options editors (My-languages + Link rules) — test"
    slug: "options-editors-test"
    type: "test"
    depends-on: ["009"]
  - id: "015"
    subject: "Options editors (My-languages + Link rules) — impl"
    slug: "options-editors-impl"
    type: "impl"
    depends-on: ["014"]
  - id: "016"
    subject: "Integration wiring in content/main.tsx"
    slug: "integration-wiring-impl"
    type: "impl"
    depends-on: ["011", "013"]
  - id: "017"
    subject: "End-to-end filter flow — test"
    slug: "e2e-filter-flow-test"
    type: "test"
    depends-on: ["016"]
  - id: "018"
    subject: "Live-DOM verification gate"
    slug: "live-dom-verification"
    type: "verification"
    depends-on: ["016"]
```

## Task File References

- [Task 001: Shared Filter types + FacetSelectors](./task-001-types-and-selectors.md)
- [Task 002: Link classifier — test](./task-002-link-classifier-test.md)
- [Task 003: Link classifier — impl](./task-003-link-classifier-impl.md)
- [Task 004: Tweet facets — test](./task-004-tweet-facets-test.md)
- [Task 005: Tweet facets — impl](./task-005-tweet-facets-impl.md)
- [Task 006: Timeline filter decide — test](./task-006-timeline-filter-test.md)
- [Task 007: Timeline filter decide — impl](./task-007-timeline-filter-impl.md)
- [Task 008: Filter store — test](./task-008-filter-store-test.md)
- [Task 009: Filter store — impl](./task-009-filter-store-impl.md)
- [Task 010: Filter applier — test](./task-010-filter-applier-test.md)
- [Task 011: Filter applier — impl](./task-011-filter-applier-impl.md)
- [Task 012: Filter bar UI — test](./task-012-filter-bar-test.md)
- [Task 013: Filter bar UI — impl](./task-013-filter-bar-impl.md)
- [Task 014: Options editors — test](./task-014-options-editors-test.md)
- [Task 015: Options editors — impl](./task-015-options-editors-impl.md)
- [Task 016: Integration wiring](./task-016-integration-wiring-impl.md)
- [Task 017: End-to-end filter flow — test](./task-017-e2e-filter-flow-test.md)
- [Task 018: Live-DOM verification gate](./task-018-live-dom-verification.md)

## BDD Coverage

| Spec §12 goal | Tasks |
|---|---|
| 1 link-classifier | 002, 003 |
| 2 tweet-facets | 004, 005 |
| 3 timeline-filter.decide | 006, 007 |
| 4 filter-store | 008, 009 |
| 5 filter-applier | 010, 011 |
| 6 filter-bar + options | 012, 013, 014, 015 |
| 7 live-DOM verification | 018 |
| 8 invariant (no-X, never load-bearing) | 010/011 (applier), 017 (e2e asserts assign/undo unaffected + no X calls) |
| integration (scanner hook, lifecycle, routes) | 016, 017 |

## Dependency Chain

```
001 (types + selectors)
 ├─ 002 ─ 003 (link-classifier) ─────────────┐
 ├─ 004 ─ 005 (tweet-facets) ────────────────┤
 ├─ 006 ─ 007 (timeline-filter) ──[needs 003]─┤
 ├─ 008 ─ 009 (filter-store) ────────────────┤
 └─ 010 (applier test)                        │
        011 (applier impl) ←── 005, 007, 009, 010
                 │
       ┌─────────┴───────────────┐
   012 ─ 013 (filter-bar)      014 ─ 015 (options)   [both need 009]
       └─────────┬───────────────┘
            016 (integration wiring) ←── 011, 013
                 ├─ 017 (e2e)
                 └─ 018 (live-DOM verification)
```

Independent parallelizable fronts after 001: {002,003}, {004,005}, {006,007 (after 003)}, {008,009}, {010}. UI {012,013} and Options {014,015} parallelize after 009. Integration 016 joins applier+bar; e2e 017 and live-DOM 018 follow.
