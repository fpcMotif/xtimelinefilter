import { SYNTHETIC_EVENT_FLAG } from "@/content/selectors";

export type CommandId =
  | "mute"
  | "not-interested"
  | "add-to-list"
  | "add-to-default-list"
  | "save-to-default-folder"
  | "open-folder-picker"
  | "block"
  | "toggle-select"
  /** Double-tap `s`: keep the focused author selected and open the List picker. */
  | "select-and-add-to-list"
  | "toggle-select-mode"
  | "toggle-filter"
  | "toggle-reveal"
  | "help"
  | "escape"
  | "undo";

export interface KeyBinding {
  combo: string;
  command: CommandId;
}

export interface KeyboardSurfaces {
  /** True while a Lasso modal must own modified Lasso keys from its input. */
  modalOpen(): boolean;
  /** Current palette binding. `null` means the palette is unavailable. */
  paletteHotkey(): string | null;
  /** Toggle the palette. False leaves the event for X. */
  togglePalette(): boolean;
}

/**
 * Default bindings (Alt+key per the user's choice). X's own action/navigation keys
 * are NOT bound: j/k (cursor), l (like), i (unassigned by X but left free), b
 * (bookmark), u (mute account), r/t/o/n, x (block), and every g-chord
 * (see CHORD_WINDOW_MS) keep their native meaning. Bare `b` is X's bookmark and
 * bare `x` is X's block — Lasso leaves both alone.
 *
 * Selection uses `s` (live X maps bare `s` to Share; we intentionally override it):
 * one `s` toggles the focused author, a second `s` within SS_WINDOW_MS keeps them
 * selected and opens the List picker. Select mode is on free `c`.
 *
 * Alt+B and Alt+Shift+B are the Folder pair: Alt+Shift+B files into the default
 * Folder, Alt+B opens the Folder Picker (#71). Mute (Alt+m) is intentionally
 * unbound at the user's request — the `mute` command still exists for
 * programmatic use. Escape/z/? and the filter keys' handlers return false when
 * Lasso has nothing to do, so X's own keys keep working. f/h are free on x.com
 * (only g+f / g+h chords use them, which the chord guard passes through).
 */
export const DEFAULT_KEYMAP: KeyBinding[] = [
  { combo: "Alt+n", command: "not-interested" },
  { combo: "Alt+l", command: "add-to-list" },
  { combo: "Alt+Shift+l", command: "add-to-default-list" },
  { combo: "Alt+Shift+b", command: "save-to-default-folder" },
  { combo: "Alt+b", command: "open-folder-picker" },
  { combo: "s", command: "toggle-select" },
  { combo: "c", command: "toggle-select-mode" },
  { combo: "f", command: "toggle-filter" },
  { combo: "h", command: "toggle-reveal" },
  { combo: "?", command: "help" },
  { combo: "Escape", command: "escape" },
  { combo: "z", command: "undo" },
];

/**
 * How long a bare `g` arms X's two-key navigation chords (g+h Home, g+s Settings,
 * g+f Drafts, …). While armed, Lasso must not consume the second key — otherwise
 * a capture-phase binding like `s` or `h` would swallow half of X's chord.
 */
export const CHORD_WINDOW_MS = 1000;

/** Double-tap window for `s` then `s` → select-and-add-to-list. */
export const SS_WINDOW_MS = 400;
const MOD_ORDER = ["Alt", "Ctrl", "Meta", "Shift"] as const;

type ComboSpec = {
  key: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  mod: boolean;
};

/** Canonical "Alt+Shift+l" form: modifiers in a fixed order, single keys lowercased. */
export function canonicalCombo(combo: string): string {
  const parts = combo
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  const key = parts.at(-1) ?? "";
  const ordered = MOD_ORDER.filter((m) => mods.has(m.toLowerCase()));
  return [...ordered, key.length === 1 ? key.toLowerCase() : key].join("+");
}

function parseCombo(combo: string): ComboSpec | null {
  const parts = combo
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts.at(-1)!;
  const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase());
  if (!key || key.includes("+") || new Set(modifiers).size !== modifiers.length) return null;
  if (modifiers.some((part) => !["alt", "ctrl", "meta", "shift", "mod"].includes(part))) {
    return null;
  }
  const mod = modifiers.includes("mod");
  if (mod && (modifiers.includes("ctrl") || modifiers.includes("meta"))) return null;
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    alt: modifiers.includes("alt"),
    ctrl: modifiers.includes("ctrl"),
    meta: modifiers.includes("meta"),
    shift: modifiers.includes("shift"),
    mod,
  };
}

function matchesSpec(spec: ComboSpec, combo: string): boolean {
  const event = parseCombo(combo);
  if (!event || spec.key !== event.key) return false;
  if (spec.alt !== event.alt || spec.shift !== event.shift) return false;
  if (spec.mod) return event.ctrl || event.meta;
  return spec.ctrl === event.ctrl && spec.meta === event.meta;
}

/** True when a user-configured combo and a static combo can match one keydown. */
export function combosCollide(first: string, second: string): boolean {
  const a = parseCombo(first);
  const b = parseCombo(second);
  if (!a || !b || a.key !== b.key) return false;
  for (const alt of [false, true]) {
    for (const ctrl of [false, true]) {
      for (const meta of [false, true]) {
        for (const shift of [false, true]) {
          const event = `${alt ? "Alt+" : ""}${ctrl ? "Ctrl+" : ""}${meta ? "Meta+" : ""}${shift ? "Shift+" : ""}${a.key}`;
          if (matchesSpec(a, event) && matchesSpec(b, event)) return true;
        }
      }
    }
  }
  return false;
}

/** Palette bindings are deliberate chords: no bare X keys and no static clashes. */
export function validatePaletteHotkey(
  combo: string,
  keymap: KeyBinding[] = DEFAULT_KEYMAP,
): string | null {
  const spec = parseCombo(combo);
  if (
    !spec ||
    !spec.key ||
    (spec.key.length > 1 &&
      !/^(Escape|Enter|Tab|Space|Arrow(?:Up|Down|Left|Right))$/.test(spec.key))
  ) {
    return "Use a key plus modifiers, e.g. Mod+Shift+F.";
  }
  if (!(spec.alt || spec.ctrl || spec.meta || spec.mod)) {
    return "Use Ctrl, Meta, Mod, or Alt.";
  }
  if (keymap.some((binding) => combosCollide(combo, binding.combo))) {
    return "That key is already used by Lasso.";
  }
  return null;
}

/** Match a configured combo with the same grammar used by the main keymap. */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const spec = parseCombo(combo);
  if (!spec) return false;
  const event = eventToCombo(e);
  return matchesSpec(spec, event);
}

/** "KeyN" → "n", "Digit3" → "3" — physical-key fallback for Alt combos. */
function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return (letter[1] as string).toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  return digit ? (digit[1] as string) : null;
}

export function eventToCombo(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.altKey) mods.push("Alt");
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.metaKey) mods.push("Meta");
  if (e.shiftKey) mods.push("Shift");
  // macOS Option+letter composes a symbol or dead key (Option+N = "˜", Option+M = "µ"),
  // so e.key never matches the binding. Keep layout-aware e.key when it is a plain
  // letter/digit (Windows/Linux Dvorak etc.); fall back to the physical key otherwise.
  const raw = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const key = e.altKey && !/^[a-z0-9]$/.test(raw) ? (keyFromCode(e.code) ?? raw) : raw;
  // A lone Shift is already encoded in the produced character ("?" is Shift+/),
  // so "?" binds as "?", while chords like Alt+Shift+l keep their Shift.
  if (key.length === 1 && mods.length === 1 && mods[0] === "Shift") mods.length = 0;
  return [...mods, key].join("+");
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable === true || /^(input|textarea|select)$/i.test(el.tagName ?? "");
}

export interface KeyboardLayerOptions {
  keymap: KeyBinding[];
  /**
   * Returning false means "Lasso had nothing to do" — the event is left for X
   * (e.g. Esc with no Lasso surface open, z with no undo armed).
   */
  run: (command: CommandId) => boolean | void;
  /** Live filter-surface intents. No listener is installed for them. */
  surfaces?: KeyboardSurfaces;
  doc?: Document;
  now?: () => number;
}

/**
 * Capture-phase keydown layer. Only suppresses keys Lasso owns (so X's native
 * shortcuts and typing keep working). j/k are never bound — X's cursor is reused.
 * Bare Alt and unbound Alt+key are never claimed: other extensions may own
 * Alt+hover download; Lasso only acts on its documented keydown chords.
 */
export function installKeyboardLayer(opts: KeyboardLayerOptions): () => void {
  const doc = opts.doc ?? document;
  const now = opts.now ?? Date.now;
  const table = new Map(opts.keymap.map((b) => [canonicalCombo(b.combo), b.command]));
  // X's g-chords (g+h, g+s, g+f, …): a bare `g` arms this window; the next
  // keydown inside it belongs to X, whatever Lasso has bound on it.
  let chordArmedUntil = 0;
  // Double-tap `s`: first toggle-select arms this; a second `s` upgrades to
  // select-and-add-to-list instead of toggling off.
  let selectTapUntil = 0;

  const handler = (e: KeyboardEvent): void => {
    // Lasso's own driver synthesizes Escape to dismiss stuck X menus — that is
    // cleanup aimed at X, not user input for this layer.
    if ((e as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]) return;
    // composedPath()[0] sees inside open shadow roots (e.g. the ListPicker's filter
    // input), where e.target is retargeted to the shadow host and looks non-editable.
    // No isComposing bail: macOS marks the Option+N dead-key keydown as composing,
    // and IME composition only happens inside editables, which this check covers.
    const target = e.composedPath?.()[0] ?? e.target;
    const typing = isTypingTarget(target);
    const modifiedModalInput = !!(
      typing &&
      opts.surfaces?.modalOpen() &&
      (e.altKey || e.ctrlKey || e.metaKey)
    );
    if (typing && !modifiedModalInput) return;
    const combo = eventToCombo(e);
    if (combo === "g") {
      chordArmedUntil = now() + CHORD_WINDOW_MS;
      selectTapUntil = 0;
      return; // g itself is X's chord prefix — never Lasso's
    }
    const chordPending = now() < chordArmedUntil;
    const xChordOwnsKey = chordPending && !modifiedModalInput;
    chordArmedUntil = 0; // any key concludes (or breaks) the chord
    let command = table.get(combo);
    // Static bindings always win a collision. Settings are checked on each keydown,
    // so a changed palette binding needs no listener rebind.
    if (command) {
      if (xChordOwnsKey) {
        selectTapUntil = 0;
        return; // the second key of g+h / g+s / g+f — X's, not ours
      }
      // s then s → select-and-add-to-list (only when bare s is toggle-select).
      if (command === "toggle-select") {
        if (now() < selectTapUntil) {
          command = "select-and-add-to-list";
          selectTapUntil = 0;
        } else {
          selectTapUntil = now() + SS_WINDOW_MS;
        }
      } else {
        selectTapUntil = 0;
      }
      if (opts.run(command) === false) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    selectTapUntil = 0;
    if (xChordOwnsKey) return;
    const paletteHotkey = opts.surfaces?.paletteHotkey();
    if (!paletteHotkey || validatePaletteHotkey(paletteHotkey, opts.keymap)) return;
    if (!matchesCombo(e, paletteHotkey)) return;
    if (opts.surfaces?.togglePalette() === false) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  doc.addEventListener("keydown", handler, true);
  return () => doc.removeEventListener("keydown", handler, true);
}
