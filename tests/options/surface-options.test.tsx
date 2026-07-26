import { fireEvent, render } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import { DEFAULT_SETTINGS } from "@/core/settings";
import { PresetManager, SurfaceOptions } from "@/options/SurfaceOptions";

describe("SurfaceOptions", () => {
  it("forwards a narrow surface patch", () => {
    const onPatch = vi.fn();
    const r = render(<SurfaceOptions settings={DEFAULT_SETTINGS} onPatch={onPatch} />);

    fireEvent.change(r.getByLabelText(/command palette/i), { target: { checked: true } });

    expect(onPatch).toHaveBeenCalledWith({ surfaces: { palette: true } });
  });

  it("forwards a valid trimmed hotkey", () => {
    const onPatch = vi.fn();
    const r = render(<SurfaceOptions settings={DEFAULT_SETTINGS} onPatch={onPatch} />);

    fireEvent.change(r.getByLabelText(/palette hotkey/i), { target: { value: " mod+k " } });

    expect(onPatch).toHaveBeenCalledWith({ paletteHotkey: "mod+k" });
  });

  it("keeps an invalid hotkey local", () => {
    const onPatch = vi.fn();
    const r = render(<SurfaceOptions settings={DEFAULT_SETTINGS} onPatch={onPatch} />);

    fireEvent.change(r.getByLabelText(/palette hotkey/i), { target: { value: "f" } });

    expect(r.getByRole("alert").textContent).toMatch(/Ctrl, Meta, Mod, or Alt/);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("adopts an authority hotkey after rerender", () => {
    const onPatch = vi.fn();
    const r = render(<SurfaceOptions settings={DEFAULT_SETTINGS} onPatch={onPatch} />);

    fireEvent.change(r.getByLabelText(/palette hotkey/i), { target: { value: "f" } });
    r.rerender(
      <SurfaceOptions
        settings={{ ...DEFAULT_SETTINGS, paletteHotkey: "ctrl+shift+k" }}
        onPatch={onPatch}
      />,
    );

    expect((r.getByLabelText(/palette hotkey/i) as HTMLInputElement).value).toBe("ctrl+shift+k");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PresetManager", () => {
  it("lists existing presets", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.savePreset("Reading");
    const r = render(<PresetManager store={store} />);
    expect(r.getByText("Reading")).toBeTruthy();
  });

  it("renames a preset via the store", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const id = store.savePreset("Reading");
    const spy = vi.spyOn(store, "renamePreset");
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("Focus"));
    const r = render(<PresetManager store={store} />);
    fireEvent.click(r.getByLabelText(/rename reading/i));
    expect(spy).toHaveBeenCalledWith(id, "Focus");
    expect(store.state.value.presets[0]?.name).toBe("Focus");
  });

  it("deletes a preset via the store", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const id = store.savePreset("Reading");
    const spy = vi.spyOn(store, "deletePreset");
    const r = render(<PresetManager store={store} />);
    fireEvent.click(r.getByLabelText(/delete reading/i));
    expect(spy).toHaveBeenCalledWith(id);
    expect(store.state.value.presets).toEqual([]);
  });

  it("leaves the name untouched when the rename prompt is cancelled", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.savePreset("Reading");
    const spy = vi.spyOn(store, "renamePreset");
    vi.stubGlobal("prompt", vi.fn().mockReturnValue(null));
    const r = render(<PresetManager store={store} />);
    fireEvent.click(r.getByLabelText(/rename reading/i));
    expect(spy).not.toHaveBeenCalled();
    expect(store.state.value.presets[0]?.name).toBe("Reading");
  });

  it("ignores a whitespace-only rename", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.savePreset("Reading");
    const spy = vi.spyOn(store, "renamePreset");
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("   "));
    const r = render(<PresetManager store={store} />);
    fireEvent.click(r.getByLabelText(/rename reading/i));
    expect(spy).not.toHaveBeenCalled();
    expect(store.state.value.presets[0]?.name).toBe("Reading");
  });

  it("renders the empty-state when there are no presets", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const r = render(<PresetManager store={store} />);
    expect(r.getByText(/no saved presets yet/i)).toBeTruthy();
  });

  it("saves the current selection as a new named preset", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const spy = vi.spyOn(store, "savePreset");
    const r = render(<PresetManager store={store} />);
    fireEvent.input(r.getByLabelText(/new preset name/i), {
      target: { value: "Focus" },
    });
    fireEvent.click(r.getByLabelText(/save preset/i));
    expect(spy).toHaveBeenCalledWith("Focus");
    expect(r.getByText("Focus")).toBeTruthy();
  });

  it("ignores a blank / whitespace-only preset name on save", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    const spy = vi.spyOn(store, "savePreset");
    const r = render(<PresetManager store={store} />);
    fireEvent.input(r.getByLabelText(/new preset name/i), {
      target: { value: "   " },
    });
    fireEvent.click(r.getByLabelText(/save preset/i));
    expect(spy).not.toHaveBeenCalled();
  });
});
