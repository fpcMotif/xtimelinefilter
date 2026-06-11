import { SYNTHETIC_EVENT_FLAG } from "@/content/selectors";

export type CommandId =
  | "mute"
  | "not-interested"
  | "add-to-list"
  | "add-to-default-list"
  | "block"
  | "toggle-select"
  | "toggle-select-mode"
  | "help"
  | "escape"
  | "undo";

export interface KeyBinding {
  combo: string;
  command: CommandId;
}

/**
 * Default bindings (Alt+key per the user's choice). j/k are NOT bound — X's native
 * cursor is reused. Block (Alt+b) is intentionally omitted (destructive, opt-in).
 * Escape/z/? handlers return false when Lasso has nothing to do, so X's own keys
 * keep working (see installKeyboardLayer).
 */
export const DEFAULT_KEYMAP: KeyBinding[] = [
  { combo: "Alt+m", command: "mute" },
  { combo: "Alt+n", command: "not-interested" },
  { combo: "Alt+l", command: "add-to-list" },
  { combo: "Alt+Shift+l", command: "add-to-default-list" },
  { combo: "x", command: "toggle-select" },
  { combo: "s", command: "toggle-select-mode" },
  { combo: "?", command: "help" },
  { combo: "Escape", command: "escape" },
  { combo: "z", command: "undo" },
];

const MOD_ORDER = ["Alt", "Ctrl", "Meta", "Shift"] as const;

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
  doc?: Document;
}

/**
 * Capture-phase keydown layer. Only suppresses keys Lasso owns (so X's native
 * shortcuts and typing keep working). j/k are never bound — X's cursor is reused.
 */
export function installKeyboardLayer(opts: KeyboardLayerOptions): () => void {
  const doc = opts.doc ?? document;
  const table = new Map(opts.keymap.map((b) => [canonicalCombo(b.combo), b.command]));

  const handler = (e: KeyboardEvent): void => {
    // Lasso's own driver synthesizes Escape to dismiss stuck X menus — that is
    // cleanup aimed at X, not user input for this layer.
    if ((e as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]) return;
    // composedPath()[0] sees inside open shadow roots (e.g. the ListPicker's filter
    // input), where e.target is retargeted to the shadow host and looks non-editable.
    // No isComposing bail: macOS marks the Option+N dead-key keydown as composing,
    // and IME composition only happens inside editables, which this check covers.
    const target = e.composedPath?.()[0] ?? e.target;
    if (isTypingTarget(target)) return;
    const command = table.get(eventToCombo(e));
    if (!command) return;
    if (opts.run(command) === false) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  doc.addEventListener("keydown", handler, true);
  return () => doc.removeEventListener("keydown", handler, true);
}
