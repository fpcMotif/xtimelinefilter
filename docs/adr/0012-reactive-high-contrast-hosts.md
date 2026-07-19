# ADR-0012 — One reactive high-contrast host registry

Status: Accepted · 2026-07-18

## Context

The content root, filter root, and tweet overlays copied `highContrast` once at boot. Options writes were live in storage but existing hosts stayed stale. New overlays also used the old boot snapshot.

## Decision

One `HighContrastHosts` instance owns every content-script host's `data-hc` attribute. It subscribes once to `SettingsStore`, tracks the current value, and exposes `register(host): dispose`. Registration applies the current value at once. Unregistering drops the host.

Main creates one settings store, reads it again when an on-demand tab activates, and owns one host registry. The content root, filter root, and each overlay register with it. CSS remains the implementation; Preact components receive no theme state.

## Grill

- Put theme in component props? No. The style boundary is the Shadow host.
- Give each feature a settings subscription? No. That splits policy and multiplies listeners.
- Query storage when each overlay mounts? No. A current-value registry is cheaper and race-safe.
- Reuse the initial on-demand snapshot? No. Options may change before activation.

## Consequences

- Existing and future hosts change together.
- Removed overlays and filter roots unregister.
- Theme policy stays outside feature and component logic.

