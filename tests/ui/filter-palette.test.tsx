import { fireEvent, render, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";

import { createFilterStore, type FilterStore } from "@/core/filter-store";
import { FilterPalette } from "@/ui/filter-palette";
import { UI_LAYER } from "@/ui/layers";

function setup(
  opts: {
    open?: boolean;
    onClose?: () => void;
    prepare?: (store: ReturnType<typeof createFilterStore>) => void;
    conduct?: (run: (s: FilterStore) => void) => void;
  } = {},
) {
  const store = createFilterStore({ navLanguages: ["ja"] });
  opts.prepare?.(store);
  const onClose = opts.onClose ?? vi.fn();
  const r = render(
    <FilterPalette
      store={store}
      open={opts.open ?? true}
      onClose={onClose}
      conduct={opts.conduct}
    />,
  );
  const input = () => r.getByRole("combobox") as HTMLInputElement;
  const type = (value: string) => fireEvent.input(input(), { target: { value } });
  const options = () => r.queryAllByRole("option");
  const labels = () => options().map((o) => o.textContent?.trim());
  return { store, r, onClose, input, type, options, labels };
}

describe("FilterPalette", () => {
  it("renders nothing when closed", () => {
    const { r } = setup({ open: false });
    expect(r.queryByRole("combobox")).toBeNull();
  });

  it("uses the modal layer", () => {
    const { r } = setup();
    const scrim = r.getByRole("presentation") as HTMLElement;
    expect(Number(scrim.style.zIndex)).toBe(UI_LAYER.modal);
  });

  it("links the editable combobox to its active option", () => {
    const { input, options, r } = setup();
    const listbox = r.getByRole("listbox");
    expect(input().getAttribute("aria-controls")).toBe(listbox.id);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0]?.id);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
  });

  it('typing "vid" offers "Only · video" and selecting it sets kind:video to only', () => {
    const { store, type, labels, options } = setup();
    type("vid");
    expect(labels()).toContain("Only · video");
    const target = options().find((o) => o.textContent?.includes("Only · video"))!;
    fireEvent.click(target);
    expect(store.state.value.criteria["kind:video"]).toBe("only");
  });

  it("routes a selected item through conduct — the fail-open wall, not a direct store call", () => {
    const conduct = vi.fn(); // no-op wall
    const { store, type, options } = setup({ conduct });
    type("vid");
    fireEvent.click(options().find((o) => o.textContent?.includes("Only · video"))!);
    expect(conduct).toHaveBeenCalledTimes(1);
    expect(store.state.value.criteria["kind:video"]).toBeUndefined();
  });

  it('typing "read" offers the preset and selecting it calls applyPreset(id)', () => {
    const applyPreset = vi.fn();
    const { store, type, options } = setup({
      prepare: (s) => {
        s.savePreset("Reading");
      },
    });
    const presetId = store.state.value.presets[0]!.id;
    vi.spyOn(store, "applyPreset").mockImplementation(applyPreset);
    type("read");
    const target = options().find((o) => o.textContent?.includes("Reading"))!;
    expect(target).toBeTruthy();
    fireEvent.click(target);
    expect(applyPreset).toHaveBeenCalledWith(presetId);
  });

  it('typing "show all" offers a reveal action that keeps the filter enabled on select', () => {
    const { store, type, options } = setup();
    expect(store.state.value.enabled).toBe(true);
    type("show all");
    const target = options().find((o) => o.textContent?.includes("Show all hidden"))!;
    expect(target).toBeTruthy();
    fireEvent.click(target);
    expect(store.revealed.value).toBe(true);
    expect(store.state.value.enabled).toBe(true); // reveal ≠ disable
  });

  it('typing "hide all" offers the re-hide action that resumes filtering on select', () => {
    const { store, type, options } = setup({
      prepare: (s) => s.setRevealed(true),
    });
    type("hide all");
    const target = options().find((o) => o.textContent?.includes("Hide all (resume filtering)"))!;
    expect(target).toBeTruthy();
    fireEvent.click(target);
    expect(store.revealed.value).toBe(false);
    expect(store.state.value.enabled).toBe(true); // re-hide ≠ disable
  });

  it("stays open after applying an item for rapid multi-toggle", () => {
    const { store, type, options, input } = setup();
    type("vid");
    fireEvent.click(options().find((o) => o.textContent?.includes("Only · video"))!);
    expect(input()).toBeTruthy();
    expect(store.state.value.criteria["kind:video"]).toBe("only");
  });

  it("Enter runs the highlighted item", () => {
    const { store, type, input } = setup();
    type("only · video");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(store.state.value.criteria["kind:video"]).toBe("only");
  });

  it("Enter selects the highlighted 'Show all hidden' command (keyboard path)", () => {
    const { store, type, input } = setup();
    type("show all"); // unique fuzzy match — lands at the highlighted row
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(store.revealed.value).toBe(true);
  });

  it("Enter runs 'Hide all' via a uniquely-matching query and resumes filtering", () => {
    const { store, type, input } = setup({
      prepare: (s) => s.setRevealed(true),
    });
    // "hide all" alone fuzzy-matches "Hide · Article/Blog" first, so query the
    // unique parenthetical to land the highlight on the re-hide command.
    type("resume");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(store.revealed.value).toBe(false);
    expect(store.state.value.enabled).toBe(true); // re-hide ≠ disable
  });

  it("Escape invokes onClose", () => {
    const onClose = vi.fn();
    const { input } = setup({ onClose });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowDown then Enter runs the next item down the list", () => {
    const { store, input } = setup();
    // First two catalog rows are "Only · text" then "Hide · text" (KIND order).
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(store.state.value.criteria["kind:text"]).toBe("hide");
  });

  it("ArrowUp wraps to the last item and runs it on Enter", () => {
    const { store, input } = setup();
    // From the top row, ArrowUp wraps to the last command: "Enable filter".
    store.setEnabled(false);
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(store.state.value.enabled).toBe(true);
  });

  it("highlights an option on mouse enter, and selecting it acts on that row", () => {
    const { store, type, options } = setup();
    type("video"); // matches both "Only · video" and "Hide · video"
    const hide = options().find((o) => o.textContent?.includes("Hide · video"))!;
    fireEvent.mouseEnter(hide);
    expect(hide.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(hide);
    expect(store.state.value.criteria["kind:video"]).toBe("hide");
  });

  it("shows a no-match row and Enter is a no-op when nothing matches", () => {
    const onClose = vi.fn();
    const { store, type, options, input, r } = setup({ onClose });
    const before = JSON.stringify(store.state.value);
    type("zzqqxx-nope");
    expect(options()).toHaveLength(0);
    expect(r.getByText(/no matching commands/i)).toBeTruthy();
    // Arrow keys and Enter must not throw or mutate state with an empty list.
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(JSON.stringify(store.state.value)).toBe(before);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores keys it does not handle", () => {
    const { store, input } = setup();
    const before = JSON.stringify(store.state.value);
    fireEvent.keyDown(input(), { key: "a" });
    expect(JSON.stringify(store.state.value)).toBe(before);
  });

  it("keeps pointer down focus-only but accepts click option activation", () => {
    const { store, type, options } = setup();
    type("video");
    const target = options().find((option) => option.textContent?.includes("Only · video"))!;
    fireEvent.mouseDown(target);
    expect(store.state.value.criteria["kind:video"]).toBeUndefined();

    fireEvent.click(target);
    expect(store.state.value.criteria["kind:video"]).toBe("only");
  });

  it("accepts Enter and Space on an option, but leaves other option keys alone", () => {
    const { store, type, options } = setup();
    type("video");
    const target = options().find((option) => option.textContent?.includes("Only · video"))!;
    const pageKeydown = vi.fn();
    document.addEventListener("keydown", pageKeydown);
    try {
      fireEvent.keyDown(target, { key: "Enter" });
      expect(store.state.value.criteria["kind:video"]).toBe("only");

      store.setMode("kind:video", "off");
      fireEvent.keyDown(target, { key: " " });
      expect(store.state.value.criteria["kind:video"]).toBe("only");
      fireEvent.keyDown(target, { key: "x" });
    } finally {
      document.removeEventListener("keydown", pageKeydown);
    }
    expect(pageKeydown).toHaveBeenCalledTimes(1);
  });

  it("stops owned combobox keys before they reach the page", () => {
    const { input } = setup();
    const pageKeydown = vi.fn();
    document.addEventListener("keydown", pageKeydown);
    try {
      for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
        fireEvent.keyDown(input(), { key });
      }
      expect(pageKeydown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", pageKeydown);
    }
  });

  it("swallows a backdrop press while closing; a card press stays untouched", () => {
    const onClose = vi.fn();
    const { r } = setup({ onClose });
    const backdrop = r.getByRole("presentation");
    const dialog = r.getByRole("dialog");
    const pageMouseDown = vi.fn();
    document.addEventListener("mousedown", pageMouseDown);
    try {
      const cardPress = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      dialog.dispatchEvent(cardPress);
      expect(onClose).not.toHaveBeenCalled();
      expect(cardPress.defaultPrevented).toBe(false);
      expect(pageMouseDown).toHaveBeenCalledOnce();

      pageMouseDown.mockClear();
      const outsidePress = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      backdrop.dispatchEvent(outsidePress);
      expect(onClose).toHaveBeenCalledOnce();
      expect(outsidePress.defaultPrevented).toBe(true);
      expect(pageMouseDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("mousedown", pageMouseDown);
    }
  });

  it("traps focus inside the shadow-root palette and restores it exactly once on Escape", async () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    const onClose = vi.fn();
    const outside = document.createElement("button");
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    shadow.appendChild(mount);
    document.body.append(outside, host);
    outside.focus();

    function ControlledPalette() {
      const [open, setOpen] = useState(true);
      return (
        <FilterPalette
          store={store}
          open={open}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        />
      );
    }

    render(<ControlledPalette />, { container: mount });
    const input = shadow.querySelector<HTMLInputElement>("input")!;
    expect(shadow.activeElement).toBe(input);

    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    input.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(shadow.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(document.activeElement).toBe(outside);
    host.remove();
    outside.remove();
  });
});
