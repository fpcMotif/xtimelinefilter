import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import { FilterBar } from "@/ui/filter-bar";

function setup(hidden = 0) {
  const store = createFilterStore({ navLanguages: ["ja"] });
  const r = render(<FilterBar store={store} hiddenCount={() => hidden} />);
  return { store, r };
}

describe("FilterBar", () => {
  it("renders tri-state chips grouped by family", () => {
    const { r } = setup();
    expect(r.getByRole("button", { name: /^Video$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Photo$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^arXiv$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Reddit$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Repost$/ })).toBeTruthy();
  });

  it("cycles a chip through the store on click", () => {
    const { store, r } = setup();
    const chip = r.getByRole("button", { name: /^Video$/ });
    fireEvent.click(chip);
    expect(store.state.value.criteria["kind:video"]).toBe("only");
    fireEvent.click(chip);
    expect(store.state.value.criteria["kind:video"]).toBe("hide");
  });

  it("toggles only-my-languages", () => {
    const { store, r } = setup();
    fireEvent.click(r.getByLabelText(/only my languages/i));
    expect(store.state.value.onlyMyLanguages).toBe(true);
  });

  it("shows the hidden count and a master toggle that disables filtering", () => {
    const { store, r } = setup(5);
    expect(r.getByText(/5 hidden/i)).toBeTruthy();
    fireEvent.click(r.getByLabelText(/timeline filter enabled/i));
    expect(store.state.value.enabled).toBe(false);
  });
});
