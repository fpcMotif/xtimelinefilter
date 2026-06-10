# ADR-0006 — Static (always-on) UI by default, with an on-demand activation option

Status: Accepted · 2026-06-08

## Context
MV3 offers two ways to get UI/page access: a statically-declared content script (auto-runs on matched sites; one-time install prompt for host access) or `activeTab` + `chrome.scripting` dynamic injection (runs only on user invocation; lighter prompt, but requires a click each session). The owner is new to extensions and wants the swift default but the ability to switch to the lighter behavior.

## Decision
Ship a **static content script** scoped to x.com/twitter.com so the UI is instantly available (swiftest UX) — this is the default. Add a settings field `activation: "auto" | "on-demand"`:
- **auto** (default): the content runtime mounts its UI immediately.
- **on-demand**: the content script still loads (it is statically declared) but stays **inert** — overlays/action bar hidden — until the user triggers it via the toolbar action (`action.onClicked` → message the tab) or the select-mode hotkey.

This gives a runtime toggle without manifest gymnastics. NOTE: true permission-minimizing `activeTab` + dynamic registration (which would also reduce the install prompt) is a deeper change deferred to a future iteration; the `on-demand` setting delivers the *behavioral* control now (UI dormant until invoked), not the reduced-permission install.

## Consequences
- Best-in-class default UX; a clear, honest toggle for users who prefer on-demand.
- Revisit `activeTab`-based injection later if reducing the install prompt becomes a priority (would change manifest + add `chrome.scripting`/`activeTab`).
