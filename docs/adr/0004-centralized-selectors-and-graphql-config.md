# ADR-0004 — Centralize all drift-prone hooks: one Selectors table + one GraphqlConfig

Status: Accepted · amended 2026-07-18

## Context
The two most fragile surfaces are x.com DOM selectors (especially the Lists-membership dialog and per-list rows — the highest-churn, least-source-backed part) and GraphQL queryIds/`features` (rotate ~2–4 weekly). Scattering these through the codebase makes X redesigns and id rotations expensive and error-prone.

## Decision
- **`content/selectors.ts`** is the single table of every DOM hook. Prefer role + visible-text/`aria-label` over deep `data-testid` chains for the menu item, list rows, and Save button; keep caret/Dropdown/dialog/`confirmationSheetConfirm`/toast as primary anchors with text/role fallbacks. Save real HTML fixtures as the regression contract.
- **`core/x-client/graphql-config.ts`** centralizes static queryIds + per-op `features`. GraphQL is explicit opt-in. A 404 reports a typed, visible stale-query-ID failure; update the static config only after live verification. Do not bridge MAIN-world fetch/XHR observations without a reviewed threat model.

## Consequences
- A redesign or ID rotation is a one-file, deliberately verified fix.
- Fixtures pin current DOM/response shapes; verification flagged the dialog internals as needing a live DevTools check before shipping the DOM backend.
