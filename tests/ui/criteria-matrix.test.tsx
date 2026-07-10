import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import { CriteriaMatrix } from "@/ui/criteria-matrix";

describe("CriteriaMatrix", () => {
  it("renders the legend and family-grouped chips (Type / Links / Source)", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    expect(r.getByText(/off.*only.*hide/i)).toBeTruthy();
    expect(r.getByText(/^Type$/i)).toBeTruthy();
    expect(r.getByText(/^Links$/i)).toBeTruthy();
    expect(r.getByText(/^Source$/i)).toBeTruthy();
    expect(r.getByRole("button", { name: /^Video$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^arXiv$/ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Repost$/ })).toBeTruthy();
  });

  it("cycles a criterion directly on the store when no conductor is given", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const spy = vi.spyOn(store, "cycle");
    const r = render(<CriteriaMatrix store={store} />);
    const chip = r.getByRole("button", { name: /^Video$/ });
    fireEvent.click(chip);
    expect(spy).toHaveBeenCalledWith("kind:video");
    expect(store.state.value.criteria["kind:video"]).toBe("only");
    expect(chip.getAttribute("data-mode")).toBe("only");
  });

  it("routes a cycle through the conductor (fail-open wall) when one is given", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const conduct = vi.fn(); // no-op wall: receives the command but never runs it
    const r = render(<CriteriaMatrix store={store} conduct={conduct} />);
    fireEvent.click(r.getByRole("button", { name: /^Video$/ }));
    expect(conduct).toHaveBeenCalledTimes(1);
    expect(store.state.value.criteria["kind:video"]).toBeUndefined();
  });

  it("renders the Engagement group with the Liked chip", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    expect(r.getByText(/^Engagement$/i)).toBeTruthy();
    expect(r.getByRole("button", { name: /^Liked$/ })).toBeTruthy();
  });

  it("cycles the Liked criterion off→only on the store", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    fireEvent.click(r.getByRole("button", { name: /^Liked$/ }));
    expect(store.state.value.criteria["engagement:liked"]).toBe("only");
  });

  it("hides the chips but keeps the legend when show is false", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} show={false} />);
    expect(r.getByText(/off.*only.*hide/i)).toBeTruthy();
    expect(r.queryByRole("button", { name: /^Video$/ })).toBeNull();
  });
});
