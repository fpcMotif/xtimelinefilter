import { describe, expect, it } from "vitest";

import { activeCriteriaCount, buildPaletteItems } from "@/core/filter-projection";
import { createFilterStore } from "@/core/filter-store";
import type { FilterState } from "@/core/filter-types";

function makeState(over: Partial<FilterState> = {}): FilterState {
  return {
    enabled: true,
    criteria: {},
    onlyMyLanguages: false,
    myLanguages: ["ja"],
    linkRules: [],
    presets: [],
    compactHidden: false,
    ...over,
  };
}

describe("activeCriteriaCount", () => {
  it("counts non-off criteria", () => {
    expect(activeCriteriaCount(makeState({ criteria: { "kind:video": "only" } }))).toBe(1);
    expect(
      activeCriteriaCount(makeState({ criteria: { "kind:video": "only", "role:repost": "hide" } })),
    ).toBe(2);
  });

  it("ignores criteria explicitly set to off (the count that funnel-pill and popup once diverged on)", () => {
    expect(activeCriteriaCount(makeState({ criteria: { "kind:video": "off" } }))).toBe(0);
    // A surviving "off" key (from a preset/external write) must not inflate the count.
    expect(
      activeCriteriaCount(makeState({ criteria: { "kind:video": "off", "role:repost": "hide" } })),
    ).toBe(1);
  });

  it("adds one for the language gate when onlyMyLanguages is true", () => {
    expect(activeCriteriaCount(makeState({ onlyMyLanguages: true }))).toBe(1);
    expect(
      activeCriteriaCount(makeState({ criteria: { "kind:video": "only" }, onlyMyLanguages: true })),
    ).toBe(2);
  });

  it("is zero on a fresh state", () => {
    expect(activeCriteriaCount(makeState())).toBe(0);
  });
});

describe("buildPaletteItems", () => {
  it("offers an Only and a Hide entry for each criterion", () => {
    const items = buildPaletteItems(makeState());
    const labels = items.map((i) => i.label);
    expect(labels).toContain("Only · video");
    expect(labels).toContain("Hide · video");
    expect(labels).toContain("Only · arXiv");
    expect(labels).toContain("Hide · Repost");
  });

  it("offers an apply entry per preset", () => {
    const state = makeState({
      presets: [
        { id: "p1", name: "Reading", criteria: { "kind:link": "only" }, onlyMyLanguages: false },
      ],
    });
    const item = buildPaletteItems(state).find((i) => i.label.includes("Reading"));
    expect(item).toBeTruthy();
  });

  it("offers the global actions", () => {
    const labels = buildPaletteItems(makeState()).map((i) => i.label);
    expect(labels).toContain("Show all hidden");
    expect(labels).toContain("Hide all (resume filtering)");
    expect(labels).toContain("Disable filter");
    expect(labels).toContain("Enable filter");
  });

  it("each item's run mutates the store", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    const only = buildPaletteItems(store.state.value).find((i) => i.label === "Only · video")!;
    only.run(store);
    expect(store.state.value.criteria["kind:video"]).toBe("only");
  });

  it("'Show all hidden' reveals without disabling; 'Disable filter' disables", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    const items = buildPaletteItems(store.state.value);
    items.find((i) => i.label === "Show all hidden")!.run(store);
    expect(store.revealed.value).toBe(true);
    expect(store.state.value.enabled).toBe(true);
    items.find((i) => i.label === "Disable filter")!.run(store);
    expect(store.state.value.enabled).toBe(false);
  });

  it("'Hide all (resume filtering)' ends the reveal without touching enabled", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setRevealed(true);
    const items = buildPaletteItems(store.state.value);
    items.find((i) => i.label === "Hide all (resume filtering)")!.run(store);
    expect(store.revealed.value).toBe(false);
    expect(store.state.value.enabled).toBe(true); // re-hide ≠ disable
  });

  it("'Enable filter' re-enables a disabled filter", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setEnabled(false);
    buildPaletteItems(store.state.value)
      .find((i) => i.label === "Enable filter")!
      .run(store);
    expect(store.state.value.enabled).toBe(true);
  });
});
