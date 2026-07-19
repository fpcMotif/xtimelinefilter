# ADR-0011 — One document keyboard owner

Status: Accepted · 2026-07-18

## Context

Four modules listened for `document.keydown`. They used two combo grammars. The palette listener captured its first setting forever, fired while typing, and could collide with Lasso or X shortcuts. Escape order depended on listener phase and focus.

## Decision

`content/keyboard` is the only document keydown owner. It keeps the capture-phase typing and X `g`-chord guards.

The filter surface manager owns palette and pill open state. It exposes four intents: read the live palette binding, toggle the palette, report whether the modal palette is open, and dismiss its top surface. It never installs a key listener.

Escape follows visible layer order: modal palette first, then app surfaces, then lower filter surfaces, then X. While the palette is open, it consumes every other Lasso command. Input-local arrows, Enter, Escape, and modal Tab traps stay on their components. In modal inputs, matching modified Lasso chords are consumed; plain typing and unmatched edit chords stay local.

Palette bindings use the same parser as the main keymap. They require Ctrl, Meta, Mod, or Alt. Invalid bindings, bare X keys, and collisions with the main keymap are rejected.

## Grill

- Generic command bus? No. It hides ownership. Four explicit surface intents are smaller.
- Global dismiss stack? No. Two fixed layer owners have a stable z-order. A registry adds machinery without leverage.
- Listener registration order as policy? No. Order is explicit and tested.
- Let Options persist invalid text? No. Keep a local draft; persist only a valid, non-colliding combo.

## Consequences

- Settings changes affect the next keydown without listener rebinding.
- Typing, macOS Option keys, X chords, and palette keys share one grammar.
- One Escape closes one highest-priority Lasso layer. If none closes, X receives it.
