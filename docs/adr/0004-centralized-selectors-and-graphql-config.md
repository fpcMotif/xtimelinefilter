# ADR-0004 — Centralize all drift-prone hooks: one Selectors table + one GraphqlConfig

Status: Accepted · 2026-06-07

## Context
The two most fragile surfaces are x.com DOM selectors (especially the Lists-membership dialog and per-list rows — the highest-churn, least-source-backed part) and GraphQL queryIds/`features` (rotate ~2–4 weekly). Scattering these through the codebase makes X redesigns and id rotations expensive and error-prone.

## Decision
- **`content/selectors.ts`** is the single table of every DOM hook. Prefer role + visible-text/`aria-label` over deep `data-testid` chains for the menu item, list rows, and Save button; keep caret/Dropdown/dialog/`confirmationSheetConfirm`/toast as primary anchors with text/role fallbacks. Save real HTML fixtures as the regression contract.
- **`core/x-client/graphql-config.ts`** centralizes queryIds + per-op `features`. Ship a snapshot only as a seed; an optional MAIN-world fetch/XHR wrapper records the app's own `OpName -> {id, features}`; treat `404` / "features cannot be null" as automatic re-discovery triggers.

## Consequences
- A redesign or id rotation is a one-file fix.
- Fixtures pin current DOM/response shapes; verification flagged the dialog internals as needing a live DevTools check before shipping the DOM backend.
