import { fireEvent, render } from "@testing-library/preact";
import { render as renderPreact } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import { FunnelPill } from "@/ui/funnel-pill";
import { UI_LAYER } from "@/ui/layers";

function setup(
  opts: {
    hidden?: number;
    prepare?: (store: ReturnType<typeof createFilterStore>) => void;
    position?: { x: number; y: number };
    onPositionChange?: (p: { x: number; y: number }) => void;
  } = {},
) {
  const store = createFilterStore({ navLanguages: ["ja"] });
  opts.prepare?.(store);
  const onPositionChange = opts.onPositionChange ?? vi.fn();
  function ControlledPill() {
    const [open, setOpen] = useState(false);
    return (
      <FunnelPill
        store={store}
        hiddenCount={() => opts.hidden ?? 0}
        position={opts.position ?? { x: 40, y: 60 }}
        onPositionChange={onPositionChange}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }
  const r = render(<ControlledPill />);
  const pill = r.getByRole("button", { name: /timeline filter/i });
  return { store, r, pill, onPositionChange };
}

/**
 * happy-dom does not implement Shadow DOM event retargeting — it leaves
 * `e.target` as the in-shadow node — so a plain `fireEvent.mouseDown(chip)`
 * cannot reproduce the production bug (the test would pass with or without the
 * fix). Reconstruct the exact event a real browser delivers to a document-level
 * listener for a click that originated inside an open shadow tree: `target`
 * retargeted to the shadow `host`, but `composedPath()` still carrying the full
 * in-shadow path (chip → … → host). The real end-to-end guard is
 * e2e/filter-surfaces.spec.ts, which runs in an actual browser.
 */
function dispatchRetargetedMouseDown(origin: Element, host: Element) {
  let composed: EventTarget[] = [];
  const capture = (e: Event) => {
    composed = e.composedPath();
  };
  origin.addEventListener("mousedown", capture);
  origin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
  origin.removeEventListener("mousedown", capture);

  const evt = new MouseEvent("mousedown", { bubbles: true, composed: true });
  Object.defineProperty(evt, "target", { configurable: true, get: () => host });
  Object.defineProperty(evt, "composedPath", {
    configurable: true,
    value: () => composed,
  });
  // Route through fireEvent so the resulting Preact re-render is flushed (act()).
  fireEvent(document, evt);
}

function prepareScenario(store: ReturnType<typeof createFilterStore>) {
  store.setMode("kind:video", "only");
  store.setOnlyMyLanguages(true);
}

describe("FunnelPill", () => {
  it("shows a badge with the active-criteria count (video only + language gate = 2)", () => {
    const { pill } = setup({ prepare: prepareScenario });
    expect(pill.textContent).toContain("2");
  });

  it("names the enabled filter and its armed-criteria count", () => {
    const { r } = setup({ prepare: prepareScenario });

    expect(r.getByRole("button", { name: "Timeline filter, on, 2 filters armed" })).toBeTruthy();
  });

  it("does not render the popover until the pill is clicked", () => {
    const { r } = setup({ prepare: prepareScenario });
    expect(r.queryByRole("dialog")).toBeNull();
    // a FilterPanel chip would only exist once open
    expect(r.queryByRole("button", { name: /^Video$/ })).toBeNull();
  });

  it("opens a popover rendering the FilterPanel chips on click", () => {
    const { r, pill } = setup({ prepare: prepareScenario });
    fireEvent.click(pill);
    expect(r.getByRole("dialog")).toBeTruthy();
    expect(r.getByRole("button", { name: /^Video\./ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^arXiv\./ })).toBeTruthy();
    expect(r.getByLabelText(/only my languages/i)).toBeTruthy();
  });

  it("anchors the popover to the pill and keeps it within the viewport (flips)", () => {
    // Pill near the bottom-right: the popover must flip up/left to stay on screen.
    const { r, pill } = setup({
      prepare: prepareScenario,
      position: { x: window.innerWidth - 20, y: window.innerHeight - 20 },
    });
    fireEvent.click(pill);
    const dialog = r.getByRole("dialog") as HTMLElement;
    const style = dialog.getAttribute("style") ?? "";
    // anchored via inline positioning, and flipped to a bottom/right anchor (not top/left)
    expect(/bottom\s*:/.test(style)).toBe(true);
    expect(/right\s*:/.test(style)).toBe(true);
  });

  it("does not own document Escape", () => {
    const { r, pill } = setup({ prepare: prepareScenario });
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(r.queryByRole("dialog")).toBeTruthy();
  });

  it("closes the popover on outside click", () => {
    const { r, pill } = setup({ prepare: prepareScenario });
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(r.queryByRole("dialog")).toBeNull();
  });

  it("keeps the popover open when a chip inside an open Shadow DOM is clicked", () => {
    // Production mounts the pill inside an open Shadow DOM (createUiRoot). A
    // mousedown that crosses the shadow boundary retargets e.target to the
    // shadow host (outside rootRef), so the document-level outside-click handler
    // must consult composedPath() — otherwise every in-popover click closes it.
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setMode("kind:video", "only");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.appendChild(mount);

    try {
      function ControlledPill() {
        const [open, setOpen] = useState(false);
        return (
          <FunnelPill
            store={store}
            hiddenCount={() => 0}
            position={{ x: 40, y: 60 }}
            onPositionChange={vi.fn()}
            open={open}
            onOpenChange={setOpen}
          />
        );
      }
      renderPreact(<ControlledPill />, mount);

      const pill = shadow.querySelector<HTMLButtonElement>(
        'button[aria-label^="Timeline filter"]',
      )!;
      fireEvent.click(pill);
      expect(shadow.querySelector('[role="dialog"]')).toBeTruthy();

      // A FilterPanel chip lives inside the popover, inside the shadow tree.
      const chip = Array.from(shadow.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Video",
      )!;
      expect(chip).toBeTruthy();

      dispatchRetargetedMouseDown(chip, host);

      // Bug repro: without composedPath() the retargeted target (the host) is
      // outside rootRef, so the popover would have closed here.
      expect(shadow.querySelector('[role="dialog"]')).toBeTruthy();
    } finally {
      renderPreact(null, mount);
      host.remove();
    }
  });

  it("keeps the popover open when a mousedown is composed onto the shadow host itself", () => {
    // composedPath contains the host but NOT the inner pill root, so the open
    // check must fall to the `path.includes(host)` operand.
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setMode("kind:video", "only");

    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.appendChild(mount);

    try {
      function ControlledPill() {
        const [open, setOpen] = useState(false);
        return (
          <FunnelPill
            store={store}
            hiddenCount={() => 0}
            position={{ x: 40, y: 60 }}
            onPositionChange={vi.fn()}
            open={open}
            onOpenChange={setOpen}
          />
        );
      }
      renderPreact(<ControlledPill />, mount);
      const pill = shadow.querySelector<HTMLButtonElement>(
        'button[aria-label^="Timeline filter"]',
      )!;
      fireEvent.click(pill);
      expect(shadow.querySelector('[role="dialog"]')).toBeTruthy();

      const evt = new MouseEvent("mousedown", {
        bubbles: true,
        composed: true,
      });
      Object.defineProperty(evt, "target", {
        configurable: true,
        get: () => host,
      });
      Object.defineProperty(evt, "composedPath", {
        configurable: true,
        value: () => [host, document, window],
      });
      fireEvent(document, evt);

      expect(shadow.querySelector('[role="dialog"]')).toBeTruthy();
    } finally {
      renderPreact(null, mount);
      host.remove();
    }
  });

  it("dims the pill and hides the badge when the filter is disabled", () => {
    const { pill } = setup({
      prepare: (s) => {
        s.setMode("kind:video", "only");
        s.setOnlyMyLanguages(true);
        s.setEnabled(false);
      },
    });
    expect(pill.textContent).not.toContain("2");
    expect(pill.getAttribute("data-enabled")).toBe("false");
  });

  it("names the disabled filter state", () => {
    const { r } = setup({
      prepare: (store) => {
        store.setMode("kind:video", "only");
        store.setEnabled(false);
      },
    });

    expect(r.getByRole("button", { name: "Timeline filter, off, 1 filter armed" })).toBeTruthy();
  });

  it("renders the pill at the provided position", () => {
    const { pill } = setup({ position: { x: 123, y: 234 } });
    const container = pill.closest("[data-funnel-pill-root]") as HTMLElement;
    const style = container.getAttribute("style") ?? "";
    expect(style).toContain("123");
    expect(style).toContain("234");
  });

  it("accepts parent position updates after mounting", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    const onPositionChange = vi.fn();
    const r = render(
      <FunnelPill
        store={store}
        hiddenCount={() => 0}
        position={{ x: 40, y: 60 }}
        onPositionChange={onPositionChange}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );

    r.rerender(
      <FunnelPill
        store={store}
        hiddenCount={() => 0}
        position={{ x: 160, y: 260 }}
        onPositionChange={onPositionChange}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );

    const root = r.container.querySelector("[data-funnel-pill-root]") as HTMLElement;
    expect(root.getAttribute("style")).toContain("160");
    expect(root.getAttribute("style")).toContain("260");
  });

  it("moves by Arrow keys, stops document handling, and describes the control", () => {
    const { r, pill } = setup({ position: { x: 100, y: 100 } });
    const documentKeydown = vi.fn();
    document.addEventListener("keydown", documentKeydown);
    try {
      expect(fireEvent.keyDown(pill, { key: "ArrowRight" })).toBe(false);
      expect(fireEvent.keyDown(pill, { key: "ArrowDown", shiftKey: true })).toBe(false);
    } finally {
      document.removeEventListener("keydown", documentKeydown);
    }

    const root = r.container.querySelector("[data-funnel-pill-root]") as HTMLElement;
    const style = root.getAttribute("style") ?? "";
    expect(style).toContain("108");
    expect(style).toContain("132");
    expect(documentKeydown).not.toHaveBeenCalled();
    expect(pill.getAttribute("aria-describedby")).toBe("lasso-funnel-pill-keyboard-help");
    expect(r.getByText(/Use Arrow keys to move/i)).toBeTruthy();
  });

  it("clamps repeated Arrow movement and persists once on keyup", () => {
    const onPositionChange = vi.fn();
    const { r, pill } = setup({
      position: { x: 0, y: 0 },
      onPositionChange,
    });

    fireEvent.keyDown(pill, { key: "ArrowLeft" });
    fireEvent.keyDown(pill, { key: "ArrowUp" });
    fireEvent.keyUp(pill, { key: "ArrowUp" });
    expect(onPositionChange).not.toHaveBeenCalled();

    fireEvent.keyDown(pill, { key: "ArrowRight" });
    fireEvent.keyDown(pill, { key: "ArrowRight", repeat: true });
    expect(onPositionChange).not.toHaveBeenCalled();
    fireEvent.keyUp(pill, { key: "ArrowRight" });

    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 16, y: 0 });
    const root = r.container.querySelector("[data-funnel-pill-root]") as HTMLElement;
    expect(root.getAttribute("style")).toContain("16");
  });

  it("does not write when Arrow movement is already at the far viewport edge", () => {
    const onPositionChange = vi.fn();
    const width = window.innerWidth || 1024;
    const height = window.innerHeight || 768;
    const { pill } = setup({
      position: { x: width - 44, y: height - 44 },
      onPositionChange,
    });

    fireEvent.keyDown(pill, { key: "ArrowRight" });
    fireEvent.keyDown(pill, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyUp(pill, { key: "ArrowDown" });

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it("persists once on blur and Arrow movement never opens the popover", () => {
    const onPositionChange = vi.fn();
    const { r, pill } = setup({
      position: { x: 100, y: 100 },
      onPositionChange,
    });

    fireEvent.keyDown(pill, { key: "ArrowLeft" });
    expect(r.queryByRole("dialog")).toBeNull();
    fireEvent.blur(pill);
    fireEvent.keyUp(pill, { key: "ArrowLeft" });

    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 92, y: 100 });
    expect(r.queryByRole("dialog")).toBeNull();
  });

  it("persists a moved position exactly once, on drop — never per pointermove", () => {
    // onPositionChange writes chrome.storage.sync (~120 writes/min quota): one
    // write per pointermove burned the whole quota in a single drag and starved
    // every later settings/filter write (the felt "state latency").
    const onPositionChange = vi.fn();
    const { pill } = setup({ position: { x: 100, y: 100 }, onPositionChange });
    fireEvent.pointerDown(pill, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(document, {
      clientX: 130,
      clientY: 120,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, {
      clientX: 160,
      clientY: 140,
      pointerId: 1,
    });
    expect(onPositionChange).not.toHaveBeenCalled(); // mid-drag: local state only
    fireEvent.pointerUp(document, { clientX: 160, clientY: 140, pointerId: 1 });
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    const last = onPositionChange.mock.calls.at(-1)![0] as {
      x: number;
      y: number;
    };
    expect(last.x).toBeGreaterThan(100);
    expect(last.y).toBeGreaterThan(100);
  });

  it("cleans document drag listeners when the pointer is cancelled", () => {
    const onPositionChange = vi.fn();
    const { pill } = setup({ position: { x: 100, y: 100 }, onPositionChange });
    fireEvent.pointerDown(pill, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(document, { pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 160, clientY: 140, pointerId: 1 });

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it("cleans document drag listeners on unmount", () => {
    const onPositionChange = vi.fn();
    const { r, pill } = setup({ position: { x: 100, y: 100 }, onPositionChange });
    fireEvent.pointerDown(pill, { clientX: 100, clientY: 100, pointerId: 1 });
    r.unmount();
    fireEvent.pointerMove(document, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 160, clientY: 140, pointerId: 1 });

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it("a drag does not toggle the popover (the trailing click is suppressed)", () => {
    const { r, pill } = setup({ position: { x: 100, y: 100 } });
    fireEvent.pointerDown(pill, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(document, {
      clientX: 160,
      clientY: 140,
      pointerId: 1,
    });
    fireEvent.pointerUp(document, { clientX: 160, clientY: 140, pointerId: 1 });
    // A real browser fires a click after the drag; it must not open the popover.
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeNull();
    // A subsequent plain click (no drag) still opens it.
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
  });

  it("mounts in its own fixed container on the pill layer", () => {
    const { pill } = setup();
    const container = pill.closest("[data-funnel-pill-root]") as HTMLElement;
    expect(container).toBeTruthy();
    const classes = container.getAttribute("class") ?? "";
    expect(Number(container.style.zIndex)).toBe(UI_LAYER.pill);
    expect(classes).toContain("fixed");
  });

  it("ignores non-Escape keys while the popover is open", () => {
    const { r, pill } = setup({ prepare: prepareScenario });
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "a" });
    expect(r.queryByRole("dialog")).toBeTruthy();
  });

  it("keeps the popover open when the mousedown lands inside the pill root", () => {
    const { r, pill } = setup({ prepare: prepareScenario });
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
    // A mousedown whose target is the pill itself: root.contains(e.target) is true.
    fireEvent.mouseDown(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
  });

  it("does not close on a mousedown event whose composedPath yields nothing", () => {
    const { r, pill } = setup({ prepare: prepareScenario });
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
    // Dispatch a real mousedown, then override composedPath to report undefined so
    // the component's `?? []` fallback yields an empty path; happy-dom has already
    // consumed the real composedPath by the time the listener runs.
    const evt = new MouseEvent("mousedown", { bubbles: true, composed: true });
    let armed = false;
    document.addEventListener(
      "mousedown",
      () => {
        if (!armed) {
          armed = true;
          Object.defineProperty(evt, "composedPath", {
            configurable: true,
            value: () => undefined,
          });
        }
      },
      true,
    );
    fireEvent(document, evt);
    // path.length === 0 ⇒ handler is a no-op, popover stays open.
    expect(r.queryByRole("dialog")).toBeTruthy();
  });

  it("falls back to default viewport dimensions when window has no size", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 0,
    });
    try {
      const onPositionChange = vi.fn();
      const { pill } = setup({
        position: { x: 100, y: 100 },
        onPositionChange,
      });
      fireEvent.pointerDown(pill, { clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(document, {
        clientX: 5000,
        clientY: 5000,
        pointerId: 1,
      });
      fireEvent.pointerUp(document, {
        clientX: 5000,
        clientY: 5000,
        pointerId: 1,
      });
      // Clamped to the 1024×768 fallback viewport minus the 44px pill.
      const last = onPositionChange.mock.calls.at(-1)![0] as {
        x: number;
        y: number;
      };
      expect(last.x).toBe(1024 - 44);
      expect(last.y).toBe(768 - 44);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: w,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: h,
      });
    }
  });

  it("a pointer drag with no net movement neither persists nor flags the position", () => {
    const onPositionChange = vi.fn();
    const { r, pill } = setup({
      position: { x: 100, y: 100 },
      onPositionChange,
    });
    fireEvent.pointerDown(pill, { clientX: 100, clientY: 100, pointerId: 1 });
    // Same coordinates → next === pos, so `moved` stays false.
    fireEvent.pointerMove(document, {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    fireEvent.pointerUp(document, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(onPositionChange).not.toHaveBeenCalled(); // nothing moved → nothing written
    // Because the drag never moved, the trailing click still toggles the popover open.
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
  });
});
