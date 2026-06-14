import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import type { FilterState } from "@/core/filter-types";
import { activeCriteriaCount, FunnelPill } from "@/ui/funnel-pill";

function makeState(over: Partial<FilterState> = {}): FilterState {
  return {
    enabled: true,
    criteria: {},
    onlyMyLanguages: false,
    myLanguages: ["ja"],
    linkRules: [],
    presets: [],
    ...over,
  };
}

function setup(opts: {
  hidden?: number;
  prepare?: (store: ReturnType<typeof createFilterStore>) => void;
  position?: { x: number; y: number };
  onPositionChange?: (p: { x: number; y: number }) => void;
} = {}) {
  const store = createFilterStore({ navLanguages: ["ja"] });
  opts.prepare?.(store);
  const onPositionChange = opts.onPositionChange ?? vi.fn();
  const r = render(
    <FunnelPill
      store={store}
      hiddenCount={() => opts.hidden ?? 0}
      position={opts.position ?? { x: 40, y: 60 }}
      onPositionChange={onPositionChange}
    />,
  );
  const pill = r.getByRole("button", { name: /timeline filter/i });
  return { store, r, pill, onPositionChange };
}

describe("activeCriteriaCount", () => {
  it("counts non-off criteria", () => {
    expect(activeCriteriaCount(makeState({ criteria: { "kind:video": "only" } }))).toBe(1);
    expect(
      activeCriteriaCount(
        makeState({ criteria: { "kind:video": "only", "role:repost": "hide" } }),
      ),
    ).toBe(2);
  });

  it("ignores criteria explicitly set to off", () => {
    expect(
      activeCriteriaCount(makeState({ criteria: { "kind:video": "off" } })),
    ).toBe(0);
  });

  it("adds one for the language gate when onlyMyLanguages is true", () => {
    expect(activeCriteriaCount(makeState({ onlyMyLanguages: true }))).toBe(1);
    expect(
      activeCriteriaCount(
        makeState({ criteria: { "kind:video": "only" }, onlyMyLanguages: true }),
      ),
    ).toBe(2);
  });

  it("is zero on a fresh state", () => {
    expect(activeCriteriaCount(makeState())).toBe(0);
  });
});

describe("FunnelPill", () => {
  function prepareScenario(store: ReturnType<typeof createFilterStore>) {
    store.setMode("kind:video", "only");
    store.setOnlyMyLanguages(true);
  }

  it("shows a badge with the active-criteria count (video only + language gate = 2)", () => {
    const { pill } = setup({ prepare: prepareScenario });
    expect(pill.textContent).toContain("2");
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
    expect(r.getByRole("button", { name: /^Video$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^arXiv$/ })).toBeTruthy();
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

  it("closes the popover on Escape", () => {
    const { r, pill } = setup({ prepare: prepareScenario });
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(r.queryByRole("dialog")).toBeNull();
  });

  it("closes the popover on outside click", () => {
    const { r, pill } = setup({ prepare: prepareScenario });
    fireEvent.click(pill);
    expect(r.queryByRole("dialog")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(r.queryByRole("dialog")).toBeNull();
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

  it("renders the pill at the provided position", () => {
    const { pill } = setup({ position: { x: 123, y: 234 } });
    const container = pill.closest("[data-funnel-pill-root]") as HTMLElement;
    const style = container.getAttribute("style") ?? "";
    expect(style).toContain("123");
    expect(style).toContain("234");
  });

  it("reports a moved position via onPositionChange after a pointer drag", () => {
    const onPositionChange = vi.fn();
    const { pill } = setup({ position: { x: 100, y: 100 }, onPositionChange });
    fireEvent.pointerDown(pill, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 160, clientY: 140, pointerId: 1 });
    expect(onPositionChange).toHaveBeenCalled();
    const last = onPositionChange.mock.calls.at(-1)![0] as { x: number; y: number };
    expect(last.x).toBeGreaterThan(100);
    expect(last.y).toBeGreaterThan(100);
  });

  it("mounts in its own container with a z-index that does not overlap the ActionBar", () => {
    const { pill } = setup();
    const container = pill.closest("[data-funnel-pill-root]") as HTMLElement;
    expect(container).toBeTruthy();
    const style = container.getAttribute("style") ?? "";
    const classes = container.getAttribute("class") ?? "";
    const z = (() => {
      const m = /z-index\s*:\s*(\d+)/.exec(style) ?? /z-\[(\d+)\]/.exec(classes);
      return m ? Number(m[1]) : NaN;
    })();
    // ActionBar sits at 2147483646; the pill must be a distinct, non-overlapping layer.
    expect(Number.isNaN(z)).toBe(false);
    expect(z).not.toBe(2147483646);
    expect(/fixed/.test(classes) || /position\s*:\s*fixed/.test(style)).toBe(true);
  });
});
