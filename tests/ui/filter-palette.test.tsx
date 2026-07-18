import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { type Conduct, createFilterStore } from "@/core/filter-store";
import { FilterPalette } from "@/ui/filter-palette";

function setup(
  opts: {
    open?: boolean;
    onClose?: () => void;
    prepare?: (store: ReturnType<typeof createFilterStore>) => void;
    conduct?: Conduct;
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
  const input = () => r.getByRole("textbox") as HTMLInputElement;
  const type = (value: string) => fireEvent.input(input(), { target: { value } });
  const options = () => r.queryAllByRole("option");
  const labels = () => options().map((o) => o.textContent?.trim());
  return { store, r, onClose, input, type, options, labels };
}

describe("FilterPalette", () => {
  it("renders nothing when closed", () => {
    const { r } = setup({ open: false });
    expect(r.queryByRole("textbox")).toBeNull();
  });

  it('typing "vid" offers "Only · video" and selecting it sets kind:video to only', () => {
    const { store, type, labels, options } = setup();
    type("vid");
    expect(labels()).toContain("Only · video");
    const target = options().find((o) => o.textContent?.includes("Only · video"))!;
    fireEvent.mouseDown(target);
    expect(store.state.value.criteria["kind:video"]).toBe("only");
  });

  it("routes a selected item through conduct — the fail-open wall, not a direct store call", () => {
    const conduct = vi.fn(); // no-op wall
    const { store, type, options } = setup({ conduct });
    type("vid");
    fireEvent.mouseDown(options().find((o) => o.textContent?.includes("Only · video"))!);
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
    fireEvent.mouseDown(target);
    expect(applyPreset).toHaveBeenCalledWith(presetId);
  });

  it('typing "show all" offers a reveal action that keeps the filter enabled on select', () => {
    const { store, type, options } = setup();
    expect(store.state.value.enabled).toBe(true);
    type("show all");
    const target = options().find((o) => o.textContent?.includes("Show all hidden"))!;
    expect(target).toBeTruthy();
    fireEvent.mouseDown(target);
    expect(store.revealed.value).toBe(true);
    expect(store.state.value.enabled).toBe(true); // reveal ≠ disable
  });

  it('typing "hide all" offers the re-hide action that resumes filtering on select', () => {
    const { store, type, options } = setup({ prepare: (s) => s.setRevealed(true) });
    type("hide all");
    const target = options().find((o) => o.textContent?.includes("Hide all (resume filtering)"))!;
    expect(target).toBeTruthy();
    fireEvent.mouseDown(target);
    expect(store.revealed.value).toBe(false);
    expect(store.state.value.enabled).toBe(true); // re-hide ≠ disable
  });

  it("stays open after applying an item for rapid multi-toggle", () => {
    const { store, type, options, input } = setup();
    type("vid");
    fireEvent.mouseDown(options().find((o) => o.textContent?.includes("Only · video"))!);
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
    const { store, type, input } = setup({ prepare: (s) => s.setRevealed(true) });
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
    fireEvent.mouseDown(hide);
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

  it("clicking the backdrop closes the palette; clicking the card does not", () => {
    const onClose = vi.fn();
    const { r } = setup({ onClose });
    const backdrop = r.getByRole("presentation");
    const dialog = r.getByRole("dialog");
    // Mousedown on the card (target ≠ currentTarget) leaves it open.
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    // Mousedown on the backdrop itself (target === currentTarget) closes it.
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
