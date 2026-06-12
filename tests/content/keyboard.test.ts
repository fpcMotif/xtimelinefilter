import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalCombo,
  eventToCombo,
  isTypingTarget,
  type KeyBinding,
  installKeyboardLayer,
} from "@/content/keyboard";

const keymap: KeyBinding[] = [
  { combo: "Alt+m", command: "mute" },
  { combo: "Alt+l", command: "add-to-list" },
  { combo: "x", command: "toggle-select" },
];

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
      eventToCombo(new KeyboardEvent("keydown", { key: "Dead", code: "KeyN", altKey: true })),
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
      eventToCombo(new KeyboardEvent("keydown", { key: "¡", code: "Digit1", altKey: true })),
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
    const e = new KeyboardEvent("keydown", { key: "m", altKey: true, cancelable: true });
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
});
