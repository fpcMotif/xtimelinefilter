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
    expect(r.getByRole("button", { name: /^Video$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Photo$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^arXiv$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Reddit$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Repost$/ })).toBeTruthy();
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
    const chip = r.getByRole("button", { name: /^Video$/ });
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

  it("shows '3 hidden' with a 'show all' override when hiddenCount returns 3", () => {
    const { store, r } = setup(3);
    expect(r.getByText(/3 hidden/i)).toBeTruthy();
    const showAll = r.getByRole("button", { name: /show all/i });
    const before = store.state.value.criteria;
    fireEvent.click(showAll);
    // temporary override — disables filtering without mutating stored criteria
    expect(store.state.value.enabled).toBe(false);
    expect(store.state.value.criteria).toEqual(before);
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
});
