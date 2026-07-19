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
    expect(r.getByRole("button", { name: /^Video\. Current mode: off\./ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^arXiv\. Current mode: off\./ })).toBeTruthy();
    expect(r.getByRole("button", { name: /^Repost\. Current mode: off\./ })).toBeTruthy();
  });

  it("cycles a criterion directly on the store when no conductor is given", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const spy = vi.spyOn(store, "cycle");
    const r = render(<CriteriaMatrix store={store} />);
    const chip = r.getByRole("button", { name: /^Video\. Current mode: off\./ });
    fireEvent.click(chip);
    expect(spy).toHaveBeenCalledWith("kind:video");
    expect(store.state.value.criteria["kind:video"]).toBe("only");
    expect(chip.getAttribute("data-mode")).toBe("only");
  });

  it("routes a cycle through the conductor (fail-open wall) when one is given", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const conduct = vi.fn(); // no-op wall: receives the command but never runs it
    const r = render(<CriteriaMatrix store={store} conduct={conduct} />);
    fireEvent.click(r.getByRole("button", { name: /^Video\. Current mode: off\./ }));
    expect(conduct).toHaveBeenCalledTimes(1);
    expect(store.state.value.criteria["kind:video"]).toBeUndefined();
  });

  it("renders the Engagement group with the Liked chip", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    expect(r.getByText(/^Engagement$/i)).toBeTruthy();
    expect(r.getByRole("button", { name: /^Liked\. Current mode: off\./ })).toBeTruthy();
  });

  it("cycles the Liked criterion off→only on the store", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    fireEvent.click(r.getByRole("button", { name: /^Liked\. Current mode: off\./ }));
    expect(store.state.value.criteria["engagement:liked"]).toBe("only");
  });

  it("hides the chips but keeps the legend when show is false", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} show={false} />);
    expect(r.getByText(/off.*only.*hide/i)).toBeTruthy();
    expect(r.queryByRole("button", { name: /^Video\. Current mode: off\./ })).toBeNull();
  });

  it("names each mode and its next click action across the full cycle", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);

    const off = r.getByRole("button", {
      name: "Video. Current mode: off. Click to show only.",
    });
    fireEvent.click(off);

    const only = r.getByRole("button", {
      name: "Video. Current mode: show only. Click to hide.",
    });
    expect(store.state.value.criteria["kind:video"]).toBe("only");
    fireEvent.click(only);

    const hide = r.getByRole("button", {
      name: "Video. Current mode: hide. Click to turn off.",
    });
    expect(store.state.value.criteria["kind:video"]).toBe("hide");
    fireEvent.click(hide);

    expect(store.state.value.criteria["kind:video"]).toBeUndefined();
    expect(
      r.getByRole("button", {
        name: "Video. Current mode: off. Click to show only.",
      }),
    ).toBeTruthy();
  });
});
