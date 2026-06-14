import { fireEvent, render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import type { FilterState } from "@/core/filter-types";
import { buildPaletteItems, FilterPalette } from "@/ui/filter-palette";

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

function setup(
  opts: {
    open?: boolean;
    onClose?: () => void;
    prepare?: (store: ReturnType<typeof createFilterStore>) => void;
  } = {},
) {
  const store = createFilterStore({ navLanguages: ["ja"] });
  opts.prepare?.(store);
  const onClose = opts.onClose ?? vi.fn();
  const r = render(<FilterPalette store={store} open={opts.open ?? true} onClose={onClose} />);
  const input = () => r.getByRole("textbox") as HTMLInputElement;
  const type = (value: string) => fireEvent.input(input(), { target: { value } });
  const options = () => r.queryAllByRole("option");
  const labels = () => options().map((o) => o.textContent?.trim());
  return { store, r, onClose, input, type, options, labels };
}

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
        {
          id: "p1",
          name: "Reading",
          criteria: { "kind:link": "only" },
          onlyMyLanguages: false,
        },
      ],
    });
    const item = buildPaletteItems(state).find((i) => i.label.includes("Reading"));
    expect(item).toBeTruthy();
  });

  it("offers the global actions", () => {
    const labels = buildPaletteItems(makeState()).map((i) => i.label);
    expect(labels).toContain("Show all hidden");
    expect(labels).toContain("Disable filter");
    expect(labels).toContain("Enable filter");
  });

  it("each item's run mutates the store", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    const only = buildPaletteItems(store.state.value).find((i) => i.label === "Only · video")!;
    only.run(store);
    expect(store.state.value.criteria["kind:video"]).toBe("only");
  });
});

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
    fireEvent.click(target);
    expect(store.state.value.criteria["kind:video"]).toBe("only");
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

  it('typing "show all" offers an action that disables the filter on select', () => {
    const { store, type, options } = setup();
    expect(store.state.value.enabled).toBe(true);
    type("show all");
    const target = options().find((o) => o.textContent?.includes("Show all hidden"))!;
    expect(target).toBeTruthy();
    fireEvent.click(target);
    expect(store.state.value.enabled).toBe(false);
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

  it("Escape invokes onClose", () => {
    const onClose = vi.fn();
    const { input } = setup({ onClose });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
