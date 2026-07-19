# ADR-0006 — Static (always-on) UI by default, with an on-demand activation option

Status: Accepted · 2026-06-08

## Context
MV3 offers two ways to get UI/page access: a statically-declared content script (auto-runs on matched sites; one-time install prompt for host access) or `activeTab` + `chrome.scripting` dynamic injection (runs only on user invocation; lighter prompt, but requires a click each session). The owner is new to extensions and wants the swift default but the ability to switch to the lighter behavior.

## Decision
Ship a **static content script** scoped to canonical x.com so the UI is instantly available (swiftest UX) — this is the default. Authenticated X calls depend on that same-origin page context. Add a settings field `activation: "auto" | "on-demand"`:
- **auto** (default): the content runtime mounts its UI immediately.
- **on-demand**: the content script still loads (it is statically declared) but stays **inert** — overlays/action bar hidden — until the user uses the popup opened from the toolbar or presses the fixed `s` select-mode key.

This gives a runtime toggle without manifest gymnastics. NOTE: true permission-minimizing `activeTab` + dynamic registration (which would also reduce the install prompt) is a deeper change deferred to a future iteration; the `on-demand` setting delivers the *behavioral* control now (UI dormant until invoked), not the reduced-permission install.

The content runtime has three states: `idle`, `booting`, and `awake`. Concurrent activation requests share one boot. Status reports awake only after every root, listener, scanner, and feature commits. A failed boot disposes partial work, returns to idle, and can be retried. Each attempt reads current Settings; an on-demand tab never reuses its injection-time snapshot. The activation message answers only after commit or rollback, so the popup never paints a failed wake as active.

## Consequences
- Best-in-class default UX; a clear, honest toggle for users who prefer on-demand.
- Boot failure cannot leave a false-awake or half-mounted tab. Retry is safe because partial lifetimes roll back in reverse order.
- Revisit `activeTab`-based injection later if reducing the install prompt becomes a priority (would change manifest + add `chrome.scripting`/`activeTab`).
