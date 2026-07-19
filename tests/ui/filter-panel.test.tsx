import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import { FilterPanel } from "@/ui/filter-panel";

function setup(hidden?: number, prepare?: (store: ReturnType<typeof createFilterStore>) => void) {
  const store = createFilterStore({ navLanguages: ["ja"] });
  prepare?.(store);
  const hiddenCount = hidden === undefined ? undefined : () => hidden;
  const r = render(<FilterPanel store={store} hiddenCount={hiddenCount} />);
  return { store, r };
}

describe("FilterPanel", () => {
  it("renders tri-state chips grouped by family plus a legend", () => {
    const { r } = setup(0);
    expect(r.getByRole("button", { name: /^Video\./ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Photo\./ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^arXiv\./ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Reddit\./ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Repost\./ })).toBeTruthy();
    // family headings
    expect(r.getByText(/^Type$/i)).toBeTruthy();
    expect(r.getByText(/^Links$/i)).toBeTruthy();
    expect(r.getByText(/^Source$/i)).toBeTruthy();
    // legend (single element carrying all three mode glyphs)
    expect(r.getByText(/off.*only.*hide/i)).toBeTruthy();
  });

  it("cycles a chip through the store on click (off → only)", () => {
    const { store, r } = setup(0);
    const spy = vi.spyOn(store, "cycle");
    const chip = r.getByRole("button", { name: /^Video\./ });
    fireEvent.click(chip);
    expect(spy).toHaveBeenCalledWith("kind:video");
    expect(store.state.value.criteria["kind:video"]).toBe("only");
    expect(chip.getAttribute("data-mode")).toBe("only");
  });

  it("master Filter toggle invokes setEnabled", () => {
    const { store, r } = setup(0);
    const spy = vi.spyOn(store, "setEnabled");
    fireEvent.click(r.getByLabelText(/timeline filter enabled/i));
    expect(spy).toHaveBeenCalledWith(false);
    expect(store.state.value.enabled).toBe(false);
  });

  it("toggles only-my-languages", () => {
    const { store, r } = setup(0);
    const spy = vi.spyOn(store, "setOnlyMyLanguages");
    fireEvent.click(r.getByLabelText(/only my languages/i));
    expect(spy).toHaveBeenCalledWith(true);
    expect(store.state.value.onlyMyLanguages).toBe(true);
  });

  it("shows '3 hidden' with a 'show all' reveal that keeps the filter armed", () => {
    const { store, r } = setup(3);
    expect(r.getByText(/3 hidden/i)).toBeTruthy();
    const showAll = r.getByRole("button", { name: /show all/i });
    const before = store.state.value.criteria;
    fireEvent.click(showAll);
    // Reveal is a transient peek: filter stays enabled, stored criteria untouched
    // — no longer the same act as "disable filter".
    expect(store.revealed.value).toBe(true);
    expect(store.state.value.enabled).toBe(true);
    expect(store.state.value.criteria).toEqual(before);
    // While revealed the line offers "hide all" (re-hide) instead of "show all".
    const hideAll = r.getByRole("button", { name: /hide all/i });
    fireEvent.click(hideAll);
    expect(store.revealed.value).toBe(false);
  });

  it("keeps the show-all/hide-all toggle in the panel even when nothing is hidden", () => {
    const { store, r } = setup(0);
    const showAll = r.getByRole("button", { name: /show all/i });
    fireEvent.click(showAll);
    expect(store.revealed.value).toBe(true);
    // It flips to a "hide all" control that re-hides everything in one click.
    fireEvent.click(r.getByRole("button", { name: /hide all/i }));
    expect(store.revealed.value).toBe(false);
  });

  it("hides the 'show all' button while the filter is disabled but keeps the count", () => {
    const { r } = setup(0, (s) => s.setEnabled(false));
    expect(r.queryByRole("button", { name: /show all/i })).toBeNull();
    expect(r.getByText(/0 hidden/i)).toBeTruthy();
  });

  it("does not render the compact-hidden toggle (it lives in the popup only)", () => {
    const { r } = setup(0);
    expect(r.queryByLabelText(/hide filtered posts completely/i)).toBeNull();
  });

  it("omits the hidden/show-all line entirely when hiddenCount is not provided", () => {
    const { r } = setup();
    expect(r.queryByText(/hidden/i)).toBeNull();
    expect(r.queryByRole("button", { name: /show all/i })).toBeNull();
  });

  it("renders a pill per preset and applies it on click", () => {
    let id = "";
    const { store, r } = setup(0, (s) => {
      id = s.savePreset("Reading");
    });
    const spy = vi.spyOn(store, "applyPreset");
    const pill = r.getByRole("button", { name: /Reading/ });
    fireEvent.click(pill);
    expect(spy).toHaveBeenCalledWith(id);
  });

  it("saves a preset with the typed name via the save control", () => {
    const { store, r } = setup(0);
    const spy = vi.spyOn(store, "savePreset");
    const input = r.getByLabelText(/preset name/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Focus" } });
    fireEvent.click(r.getByRole("button", { name: /^save$/i }));
    expect(spy).toHaveBeenCalledWith("Focus");
  });

  it("does not save when the preset name is empty or whitespace", () => {
    const { store, r } = setup(0);
    const spy = vi.spyOn(store, "savePreset");
    const input = r.getByLabelText(/preset name/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.click(r.getByRole("button", { name: /^save$/i }));
    expect(spy).not.toHaveBeenCalled();
  });

  describe("conducting Filter commands (in-page)", () => {
    it("routes a criterion chip through conduct — the fail-open wall, not a direct store call", () => {
      const store = createFilterStore({ navLanguages: ["ja"] });
      const conduct = vi.fn(); // no-op wall: receives the command but does not run it
      const r = render(<FilterPanel store={store} conduct={conduct} />);
      fireEvent.click(r.getByRole("button", { name: /^Video\./ }));
      expect(conduct).toHaveBeenCalledTimes(1);
      expect(store.state.value.criteria["kind:video"]).toBeUndefined();
    });

    it("routes show-all (reveal) through conduct", () => {
      const store = createFilterStore({ navLanguages: ["ja"] });
      const conduct = vi.fn();
      const r = render(<FilterPanel store={store} hiddenCount={() => 3} conduct={conduct} />);
      fireEvent.click(r.getByRole("button", { name: /show all/i }));
      expect(conduct).toHaveBeenCalledTimes(1);
      expect(store.revealed.value).toBe(false);
    });

    it("routes preset apply through conduct", () => {
      const store = createFilterStore({ navLanguages: ["ja"] });
      store.savePreset("Reading");
      const conduct = vi.fn();
      const r = render(<FilterPanel store={store} conduct={conduct} />);
      fireEvent.click(r.getByRole("button", { name: /Reading/ }));
      expect(conduct).toHaveBeenCalledTimes(1);
    });

    it("lets the conductor run preset apply", () => {
      const store = createFilterStore({ navLanguages: ["ja"] });
      const id = store.savePreset("Reading");
      const apply = vi.spyOn(store, "applyPreset");
      const conduct = (run: (target: typeof store) => void) => run(store);
      const r = render(<FilterPanel store={store} conduct={conduct} />);
      fireEvent.click(r.getByRole("button", { name: /Reading/ }));
      expect(apply).toHaveBeenCalledWith(id);
    });

    it("keeps preference controls (master enable) direct even when conducting", () => {
      const store = createFilterStore({ navLanguages: ["ja"] });
      const conduct = vi.fn();
      const r = render(<FilterPanel store={store} conduct={conduct} />);
      fireEvent.click(r.getByLabelText(/timeline filter enabled/i));
      expect(store.state.value.enabled).toBe(false); // applied directly
      expect(conduct).not.toHaveBeenCalled(); // the wall is only for commands
    });
  });
});
