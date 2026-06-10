# ADR-0003 — UI is a Preact tree in an open Shadow DOM; never innerHTML of fetched data

Status: Accepted · 2026-06-07

## Context
x.com is a React app that re-renders aggressively and ships its own global CSS; injected UI must survive churn and not bleed styles. MV3 CSP forbids `eval`/`new Function`/remote code and cannot be relaxed for extension pages. The reference repo injects UI via `innerHTML` strings with `z-index: 2147483647`, which risks XSS (if fetched data is interpolated) and CSS collisions.

## Decision
Render all UI as a **Preact** component tree mounted into an **open Shadow DOM** root (`host.style.all = 'initial'`) attached high in the document, re-attached via a debounced MutationObserver + `WeakSet` dedupe. Use DOM APIs/`textContent`, never `innerHTML` of fetched content. Any MAIN-world/page-loaded asset is declared in `web_accessible_resources` scoped to x.com. Selection state is framework-agnostic (`@preact/signals`), so the UI layer is swappable.

## Consequences
- Style isolation from x.com; no XSS via injected data; CSP-clean (bundle all logic, only remote *data* allowed).
- Component tests use `@testing-library/preact`; all assertions are async (`findBy`/`waitFor`).
