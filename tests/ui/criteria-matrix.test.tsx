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
    expect(r.getByRole("slider", { name: "Video" })).toBeTruthy();
    expect(r.getByRole("slider", { name: "arXiv" })).toBeTruthy();
    expect(r.getByRole("slider", { name: "Repost" })).toBeTruthy();
  });

  it("exposes each chip's mode as a slider value under a stable name", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    const chip = r.getByRole("slider", { name: "Video" });
    expect(chip.getAttribute("aria-valuemin")).toBe("0");
    expect(chip.getAttribute("aria-valuemax")).toBe("2");
    expect(chip.getAttribute("aria-valuenow")).toBe("0");
    expect(chip.getAttribute("aria-valuetext")).toBe("off");
  });

  it("cycles a criterion directly on the store when no conductor is given", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const spy = vi.spyOn(store, "cycle");
    const r = render(<CriteriaMatrix store={store} />);
    const chip = r.getByRole("slider", { name: "Video" });
    fireEvent.click(chip);
    expect(spy).toHaveBeenCalledWith("kind:video");
    expect(store.state.value.criteria["kind:video"]).toBe("only");
    expect(chip.getAttribute("data-mode")).toBe("only");
    expect(chip.getAttribute("aria-valuetext")).toBe("show only");
  });

  it("routes a cycle through the conductor (fail-open wall) when one is given", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const conduct = vi.fn(); // no-op wall: receives the command but never runs it
    const r = render(<CriteriaMatrix store={store} conduct={conduct} />);
    fireEvent.click(r.getByRole("slider", { name: "Video" }));
    expect(conduct).toHaveBeenCalledTimes(1);
    expect(store.state.value.criteria["kind:video"]).toBeUndefined();
  });

  it("renders the Engagement group with the Liked chip", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    expect(r.getByText(/^Engagement$/i)).toBeTruthy();
    expect(r.getByRole("slider", { name: "Liked" })).toBeTruthy();
  });

  it("cycles the Liked criterion off→only on the store", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    fireEvent.click(r.getByRole("slider", { name: "Liked" }));
    expect(store.state.value.criteria["engagement:liked"]).toBe("only");
  });

  it("hides the chips but keeps the legend when show is false", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} show={false} />);
    expect(r.getByText(/off.*only.*hide/i)).toBeTruthy();
    expect(r.queryByRole("slider", { name: "Video" })).toBeNull();
  });

  it("walks the full cycle with a stable name and a changing value", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);

    const chip = r.getByRole("slider", { name: "Video" });
    expect(chip.getAttribute("aria-valuetext")).toBe("off");

    fireEvent.click(chip);
    expect(store.state.value.criteria["kind:video"]).toBe("only");
    expect(chip.getAttribute("aria-valuetext")).toBe("show only");

    fireEvent.click(chip);
    expect(store.state.value.criteria["kind:video"]).toBe("hide");
    expect(chip.getAttribute("aria-valuetext")).toBe("hide");

    fireEvent.click(chip);
    expect(store.state.value.criteria["kind:video"]).toBeUndefined();
    expect(chip.getAttribute("aria-valuetext")).toBe("off");
  });

  it("moves along the scale with arrow keys, Home, and End", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<CriteriaMatrix store={store} />);
    const chip = r.getByRole("slider", { name: "Video" });

    fireEvent.keyDown(chip, { key: "ArrowRight" });
    expect(store.state.value.criteria["kind:video"]).toBe("only");

    fireEvent.keyDown(chip, { key: "ArrowRight" });
    expect(store.state.value.criteria["kind:video"]).toBe("hide");

    fireEvent.keyDown(chip, { key: "ArrowLeft" });
    expect(store.state.value.criteria["kind:video"]).toBe("only");

    fireEvent.keyDown(chip, { key: "End" });
    expect(store.state.value.criteria["kind:video"]).toBe("hide");

    fireEvent.keyDown(chip, { key: "Home" });
    expect(store.state.value.criteria["kind:video"]).toBeUndefined();

    // Keys that don't target a mode leave the store alone.
    fireEvent.keyDown(chip, { key: "Enter" });
    expect(store.state.value.criteria["kind:video"]).toBeUndefined();
  });

  it("routes a keyboard jump through the conductor as one command", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    let runs = 0;
    const conduct = (run: (s: typeof store) => void) => {
      runs += 1;
      run(store);
    };
    const r = render(<CriteriaMatrix store={store} conduct={conduct} />);
    fireEvent.keyDown(r.getByRole("slider", { name: "Video" }), { key: "End" });
    expect(runs).toBe(1);
    expect(store.state.value.criteria["kind:video"]).toBe("hide");
  });
});
