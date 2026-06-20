import { fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import { createSettings, type StorageLike } from "@/core/settings";
import { PresetManager, SurfaceOptions } from "@/options/SurfaceOptions";

function memoryArea(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get() {
      return { ...data };
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

describe("SurfaceOptions", () => {
  it("toggling Command palette persists surfaces.palette = true", async () => {
    const settings = createSettings(memoryArea());
    const r = render(<SurfaceOptions settings={settings} />);
    const box = (await waitFor(() => r.getByLabelText(/command palette/i))) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.change(box, { target: { checked: true } });
    await waitFor(async () => expect((await settings.get()).surfaces.palette).toBe(true));
  });

  it("keeps the other surface toggles intact when one changes", async () => {
    const settings = createSettings(memoryArea());
    const r = render(<SurfaceOptions settings={settings} />);
    const palette = (await waitFor(() => r.getByLabelText(/command palette/i))) as HTMLInputElement;
    fireEvent.change(palette, { target: { checked: true } });
    await waitFor(async () => {
      const s = await settings.get();
      expect(s.surfaces).toEqual({ pill: true, palette: true });
    });
  });

  it("changing the palette hotkey persists paletteHotkey", async () => {
    const settings = createSettings(memoryArea());
    const r = render(<SurfaceOptions settings={settings} />);
    const field = (await waitFor(() => r.getByLabelText(/palette hotkey/i))) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "mod+k" } });
    await waitFor(async () => expect((await settings.get()).paletteHotkey).toBe("mod+k"));
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
});
