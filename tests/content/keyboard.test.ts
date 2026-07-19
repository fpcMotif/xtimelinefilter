import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalCombo,
  CHORD_WINDOW_MS,
  combosCollide,
  DEFAULT_KEYMAP,
  eventToCombo,
  isTypingTarget,
  type KeyBinding,
  installKeyboardLayer,
  validatePaletteHotkey,
} from "@/content/keyboard";
import { SYNTHETIC_EVENT_FLAG } from "@/content/selectors";

const keymap: KeyBinding[] = [
  { combo: "Alt+m", command: "mute" },
  { combo: "Alt+l", command: "add-to-list" },
  { combo: "x", command: "toggle-select" },
];

function pressKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

describe("combo normalization", () => {
  it("canonicalizes modifier order and key case", () => {
    expect(canonicalCombo("Shift+Alt+L")).toBe("Alt+Shift+l");
    expect(canonicalCombo("x")).toBe("x");
    expect(canonicalCombo("Ctrl+Enter")).toBe("Ctrl+Enter");
    expect(canonicalCombo("")).toBe("");
  });

  it("derives a canonical combo from a KeyboardEvent", () => {
    expect(eventToCombo(new KeyboardEvent("keydown", { key: "m", altKey: true }))).toBe("Alt+m");
  });

  it("includes Ctrl, Meta, and Shift modifiers in event order", () => {
    expect(
      eventToCombo(
        new KeyboardEvent("keydown", {
          key: "K",
          altKey: true,
          ctrlKey: true,
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe("Alt+Ctrl+Meta+Shift+k");
  });

  it("resolves Alt combos from the physical key on macOS (Option composes e.key)", () => {
    // Option+N is a dead key (˜), Option+M is µ, Option+L is ¬ — e.key is useless here.
    expect(
      eventToCombo(
        new KeyboardEvent("keydown", {
          key: "Dead",
          code: "KeyN",
          altKey: true,
        }),
      ),
    ).toBe("Alt+n");
    expect(
      eventToCombo(new KeyboardEvent("keydown", { key: "µ", code: "KeyM", altKey: true })),
    ).toBe("Alt+m");
    expect(
      eventToCombo(new KeyboardEvent("keydown", { key: "¬", code: "KeyL", altKey: true })),
    ).toBe("Alt+l");
  });

  it("keeps layout-aware e.key for non-Alt keys", () => {
    expect(eventToCombo(new KeyboardEvent("keydown", { key: "x", code: "KeyX" }))).toBe("x");
  });

  it("keeps layout-aware e.key for Alt combos when it is a plain letter (Dvorak on Windows)", () => {
    // Dvorak: the keycap labeled n sits on physical KeyL — the label must win.
    expect(
      eventToCombo(new KeyboardEvent("keydown", { key: "n", code: "KeyL", altKey: true })),
    ).toBe("Alt+n");
  });

  it("falls back from Alt symbols to physical digit codes when available", () => {
    expect(
      eventToCombo(
        new KeyboardEvent("keydown", {
          key: "¡",
          code: "Digit1",
          altKey: true,
        }),
      ),
    ).toBe("Alt+1");
  });

  it("keeps the raw Alt key when the physical code cannot be mapped", () => {
    expect(
      eventToCombo(new KeyboardEvent("keydown", { key: "F13", code: "F13", altKey: true })),
    ).toBe("Alt+F13");
  });
});

describe("isTypingTarget", () => {
  it("recognizes null, contenteditable, textarea, and select targets", () => {
    expect(isTypingTarget(null)).toBe(false);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });
});

describe("installKeyboardLayer", () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.innerHTML = "";
  });

  it("runs the bound command and prevents default", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({ keymap, run, doc: document });
    const e = new KeyboardEvent("keydown", {
      key: "m",
      altKey: true,
      cancelable: true,
    });
    document.dispatchEvent(e);
    expect(run).toHaveBeenCalledWith("mute");
    expect(e.defaultPrevented).toBe(true);
  });

  it("uses the default document when none is passed", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({ keymap, run });
    const e = new KeyboardEvent("keydown", { key: "x", cancelable: true });
    document.dispatchEvent(e);
    expect(run).toHaveBeenCalledWith("toggle-select");
  });

  it("falls back to event.target when composedPath is unavailable", () => {
    const run = vi.fn();
    let handler: ((event: KeyboardEvent) => void) | undefined;
    const doc = {
      addEventListener: vi.fn((_type, cb) => {
        handler = cb as (event: KeyboardEvent) => void;
      }),
      removeEventListener: vi.fn(),
    } as unknown as Document;
    dispose = installKeyboardLayer({ keymap, run, doc });
    handler?.({
      key: "x",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: document.body,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent);
    expect(run).toHaveBeenCalledWith("toggle-select");
  });

  it("ignores Lasso's own synthetic events (the cleanup Escape it fires at X)", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({ keymap, run, doc: document });
    const e = new KeyboardEvent("keydown", { key: "x", cancelable: true });
    (e as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG] = true;
    document.dispatchEvent(e);
    expect(run).not.toHaveBeenCalled(); // synthetic → not user input for this layer
  });

  it("fires Alt+n (not-interested) from a macOS dead-key event", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({
      keymap: [{ combo: "Alt+n", command: "not-interested" }],
      run,
      doc: document,
    });
    const e = new KeyboardEvent("keydown", {
      key: "Dead",
      code: "KeyN",
      altKey: true,
      cancelable: true,
    });
    document.dispatchEvent(e);
    expect(run).toHaveBeenCalledWith("not-interested");
    expect(e.defaultPrevented).toBe(true);
  });

  it("fires even when the dead-key keydown is flagged as composing (macOS Option+N)", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({
      keymap: [{ combo: "Alt+n", command: "not-interested" }],
      run,
      doc: document,
    });
    const e = new KeyboardEvent("keydown", {
      key: "Dead",
      code: "KeyN",
      altKey: true,
      isComposing: true,
      cancelable: true,
    });
    document.dispatchEvent(e);
    expect(run).toHaveBeenCalledWith("not-interested");
  });

  it("runs bare x for selection", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({ keymap, run, doc: document });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(run).toHaveBeenCalledWith("toggle-select");
  });

  it("ignores unbound keys (e.g. native j/k)", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({ keymap, run, doc: document });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "m" })); // bare m = native DM, not ours
    expect(run).not.toHaveBeenCalled();
  });

  it("ignores keys while typing in an input", () => {
    const run = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispose = installKeyboardLayer({ keymap, run, doc: document });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", altKey: true, bubbles: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves dormant select-mode s alone while typing", () => {
    const activate = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispose = installKeyboardLayer({
      keymap: [{ combo: "s", command: "toggle-select-mode" }],
      run: activate,
      doc: document,
    });
    const event = new KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(activate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores keys typed into an input inside an open shadow root (ListPicker filter)", () => {
    const run = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const input = document.createElement("input");
    host.attachShadow({ mode: "open" }).appendChild(input);
    dispose = installKeyboardLayer({ keymap, run, doc: document });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true, composed: true }));
    expect(run).not.toHaveBeenCalled();
  });

  it("uses the live palette setting without rebinding the document listener", () => {
    const run = vi.fn();
    let hotkey: string | null = "Mod+Shift+p";
    const togglePalette = vi.fn(() => true);
    dispose = installKeyboardLayer({
      keymap,
      run,
      doc: document,
      surfaces: {
        paletteHotkey: () => hotkey,
        togglePalette,
        modalOpen: () => false,
      },
    });
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(togglePalette).toHaveBeenCalledTimes(1);
    hotkey = "Alt+q";
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "q",
        altKey: true,
        cancelable: true,
      }),
    );
    expect(togglePalette).toHaveBeenCalledTimes(2);
  });

  it("leaves palette chords alone while typing", () => {
    const togglePalette = vi.fn(() => true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispose = installKeyboardLayer({
      keymap,
      run: vi.fn(),
      doc: document,
      surfaces: {
        paletteHotkey: () => "Mod+Shift+p",
        togglePalette,
        modalOpen: () => false,
      },
    });
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(togglePalette).not.toHaveBeenCalled();
  });

  it("swallows bound modified commands from a Picker input but leaves editing keys local", () => {
    const run = vi.fn(() => true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispose = installKeyboardLayer({
      keymap,
      run,
      doc: document,
      surfaces: {
        paletteHotkey: () => null,
        togglePalette: () => false,
        modalOpen: () => true,
      },
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    const pageKeydown = vi.fn();
    document.addEventListener("keydown", pageKeydown);
    try {
      const bound = new KeyboardEvent("keydown", {
        key: "l",
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(bound);
      expect(run).toHaveBeenCalledWith("add-to-list");
      expect(bound.defaultPrevented).toBe(true);
      expect(pageKeydown).not.toHaveBeenCalled();

      for (const init of [
        { key: "x" },
        { key: "a", metaKey: true },
        { key: "c", metaKey: true },
        { key: "v", metaKey: true },
        { key: "Escape" },
        { key: "ArrowDown" },
      ]) {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }),
        );
      }
      expect(run).toHaveBeenCalledTimes(1);
      expect(pageKeydown).toHaveBeenCalledTimes(6);
    } finally {
      document.removeEventListener("keydown", pageKeydown);
    }
  });

  it("swallows the palette hotkey from the open palette input", () => {
    const togglePalette = vi.fn(() => true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispose = installKeyboardLayer({
      keymap,
      run: vi.fn(),
      doc: document,
      surfaces: {
        paletteHotkey: () => "Mod+Shift+p",
        togglePalette,
        modalOpen: () => true,
      },
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    const pageKeydown = vi.fn();
    document.addEventListener("keydown", pageKeydown);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      expect(togglePalette).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
      expect(pageKeydown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", pageKeydown);
    }
  });

  it("keeps static bindings ahead of a stale colliding palette setting", () => {
    const run = vi.fn(() => true);
    const togglePalette = vi.fn(() => true);
    dispose = installKeyboardLayer({
      keymap: [{ combo: "Alt+p", command: "help" }],
      run,
      doc: document,
      surfaces: {
        paletteHotkey: () => "Alt+p",
        togglePalette,
        modalOpen: () => false,
      },
    });
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        altKey: true,
        cancelable: true,
      }),
    );
    expect(run).toHaveBeenCalledWith("help");
    expect(togglePalette).not.toHaveBeenCalled();
  });
});

describe("palette hotkey validation", () => {
  it("requires a modifier and rejects static collisions", () => {
    expect(validatePaletteHotkey("f")).toMatch(/Ctrl, Meta, Mod, or Alt/);
    expect(validatePaletteHotkey("Alt+n")).toMatch(/already used/);
    expect(validatePaletteHotkey("Mod+Shift+p")).toBeNull();
  });

  it("recognizes Mod collisions with platform-specific bindings", () => {
    expect(combosCollide("Mod+p", "Ctrl+p")).toBe(true);
    expect(combosCollide("Mod+p", "Meta+p")).toBe(true);
    expect(combosCollide("Alt+p", "Ctrl+p")).toBe(false);
  });

  it("rejects malformed modifiers and unsupported named keys", () => {
    expect(validatePaletteHotkey("Alt+Hyper+p")).toMatch(/Use a key plus modifiers/);
    expect(validatePaletteHotkey("Alt+F13")).toMatch(/Use a key plus modifiers/);
  });
});

describe("story beats 5 & 6 — the full keyboard layer", () => {
  it("? maps to itself (Shift is part of the character, not the combo)", () => {
    expect(eventToCombo(new KeyboardEvent("keydown", { key: "?", shiftKey: true }))).toBe("?");
  });

  it("Alt+Shift+L (the default-List chord) keeps Shift in the combo", () => {
    expect(
      eventToCombo(
        new KeyboardEvent("keydown", {
          key: "L",
          code: "KeyL",
          altKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe("Alt+Shift+l");
    // macOS composes Alt+Shift+L into a symbol — the physical key must win.
    expect(
      eventToCombo(
        new KeyboardEvent("keydown", {
          key: "Ò",
          code: "KeyL",
          altKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe("Alt+Shift+l");
  });

  it("Escape and z resolve to bindable combos", () => {
    expect(eventToCombo(new KeyboardEvent("keydown", { key: "Escape" }))).toBe("Escape");
    expect(eventToCombo(new KeyboardEvent("keydown", { key: "z" }))).toBe("z");
  });

  it("a run handler returning false leaves the event for X (Esc with nothing open)", () => {
    const run = vi.fn(() => false);
    const dispose2 = installKeyboardLayer({
      keymap: [{ combo: "Escape", command: "escape" }],
      run,
      doc: document,
    });
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    document.dispatchEvent(e);
    expect(run).toHaveBeenCalledWith("escape");
    expect(e.defaultPrevented).toBe(false);
    dispose2();
  });

  it("the default keymap covers the whole product story surface", () => {
    const commands = Object.fromEntries(DEFAULT_KEYMAP.map((b) => [b.combo, b.command]));
    expect(commands["Alt+l"]).toBe("add-to-list");
    expect(commands["Alt+Shift+l"]).toBe("add-to-default-list");
    expect(commands["Alt+m"]).toBeUndefined(); // mute is intentionally unbound
    expect(commands["Alt+n"]).toBe("not-interested");
    expect(commands["s"]).toBe("toggle-select-mode");
    expect(commands["x"]).toBe("toggle-select");
    expect(commands["f"]).toBe("toggle-filter");
    expect(commands["h"]).toBe("toggle-reveal");
    expect(commands["?"]).toBe("help");
    expect(commands["Escape"]).toBe("escape");
    expect(commands["z"]).toBe("undo");
  });

  it("never binds X's own action/navigation keys (i/k/l/j/b/u/r/t/o/n stay native)", () => {
    const bound = new Set(DEFAULT_KEYMAP.map((b) => b.combo));
    for (const native of ["i", "k", "l", "j", "b", "u", "r", "t", "o", "n", "g", "."]) {
      expect(bound.has(native)).toBe(false);
    }
  });
});

describe("X g-chord passthrough (g+h Home, g+s Settings, g+f Drafts, …)", () => {
  const chordMap: KeyBinding[] = [
    { combo: "s", command: "toggle-select-mode" },
    { combo: "h", command: "toggle-reveal" },
    { combo: "f", command: "toggle-filter" },
  ];
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it("leaves dormant select-mode s to X while g+s is armed", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({ keymap: chordMap, run, doc: document });
    const g = pressKey("g");
    expect(g.defaultPrevented).toBe(false); // g itself always passes through
    const s = pressKey("s");
    expect(run).not.toHaveBeenCalled();
    expect(s.defaultPrevented).toBe(false);
    // The chord is concluded — a plain s afterwards is Lasso's again.
    pressKey("s");
    expect(run).toHaveBeenCalledWith("toggle-select-mode");
  });

  it("an expired chord window hands the key back to Lasso", () => {
    const run = vi.fn();
    let t = 0;
    dispose = installKeyboardLayer({
      keymap: chordMap,
      run,
      doc: document,
      now: () => t,
    });
    pressKey("g");
    t = CHORD_WINDOW_MS + 1;
    pressKey("h");
    expect(run).toHaveBeenCalledWith("toggle-reveal");
  });

  it("an unbound key concludes the chord without blocking the next binding", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({ keymap: chordMap, run, doc: document });
    pressKey("g");
    pressKey("j"); // X's cursor key ends the chord
    pressKey("f");
    expect(run).toHaveBeenCalledWith("toggle-filter");
  });

  it("a modified g (Ctrl+g) does not arm the chord", () => {
    const run = vi.fn();
    dispose = installKeyboardLayer({ keymap: chordMap, run, doc: document });
    pressKey("g", { ctrlKey: true });
    pressKey("f");
    expect(run).toHaveBeenCalledWith("toggle-filter");
  });
});
