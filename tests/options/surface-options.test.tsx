import { fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import {
  createSettings,
  DEFAULT_SETTINGS,
  type LassoSettings,
  type SettingsStore,
} from "@/core/settings";
import { PresetManager, SurfaceOptions } from "@/options/SurfaceOptions";

import { createMemoryArea as memoryArea } from "../helpers/chrome-fake";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SurfaceOptions", () => {
  it("subscribes before the initial get and ignores its stale result", async () => {
    const read = deferred<LassoSettings>();
    let emit!: (snapshot: LassoSettings) => void;
    const newer = {
      ...DEFAULT_SETTINGS,
      surfaces: { pill: false, palette: true },
      paletteHotkey: "ctrl+shift+k",
    };
    const settings: SettingsStore = {
      get: () => {
        expect(emit).toBeTypeOf("function");
        emit(newer);
        return read.promise;
      },
      set: async () => DEFAULT_SETTINGS,
      subscribe(cb) {
        emit = cb;
        return () => {};
      },
    };
    const r = render(<SurfaceOptions settings={settings} />);
    read.resolve(DEFAULT_SETTINGS);

    const palette = (await waitFor(() => r.getByLabelText(/command palette/i))) as HTMLInputElement;
    expect(palette.checked).toBe(true);
    expect((r.getByLabelText(/palette hotkey/i) as HTMLInputElement).value).toBe("ctrl+shift+k");
  });

  it("shows an accessible error when the initial read fails", async () => {
    const settings: SettingsStore = {
      get: () => Promise.reject(new Error("read failed")),
      set: async () => DEFAULT_SETTINGS,
      subscribe: () => () => {},
    };
    const r = render(<SurfaceOptions settings={settings} />);

    expect((await waitFor(() => r.getByRole("alert"))).textContent).toMatch(
      /could not load surface settings/i,
    );
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("write failed");
      },
    ],
    ["rejects", () => Promise.reject(new Error("write failed"))],
  ])("shows an accessible save error when settings.set %s", async (_kind, fail) => {
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: fail as SettingsStore["set"],
      subscribe: () => () => {},
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const palette = (await waitFor(() => r.getByLabelText(/command palette/i))) as HTMLInputElement;
    fireEvent.change(palette, { target: { checked: true } });

    expect((await waitFor(() => r.getByRole("alert"))).textContent).toMatch(
      /could not save surface settings/i,
    );
  });

  it("does not let an older save overwrite newer or external settings", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const saves = [first, second];
    let emit!: (snapshot: LassoSettings) => void;
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => saves.shift()!.promise),
      subscribe(cb) {
        emit = cb;
        return () => {};
      },
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const field = (await waitFor(() => r.getByLabelText(/palette hotkey/i))) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "mod+k" } });
    fireEvent.change(field, { target: { value: "ctrl+shift+k" } });

    const newest = { ...DEFAULT_SETTINGS, paletteHotkey: "ctrl+shift+k" };
    second.resolve(newest);
    await waitFor(() => expect(field.value).toBe("ctrl+shift+k"));

    first.resolve({ ...DEFAULT_SETTINGS, paletteHotkey: "mod+k" });
    await Promise.resolve();
    expect(field.value).toBe("ctrl+shift+k");

    const external = { ...DEFAULT_SETTINGS, paletteHotkey: "alt+p" };
    emit(external);
    await waitFor(() => expect(field.value).toBe("alt+p"));
    expect(field.value).toBe("alt+p");
  });

  it("merges rapid surface toggles from the newest optimistic snapshot", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const saves = [first, second];
    const set = vi.fn(() => saves.shift()!.promise);
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set,
      subscribe: () => () => {},
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const pill = (await waitFor(() => r.getByLabelText(/floating pill/i))) as HTMLInputElement;
    const palette = r.getByLabelText(/command palette/i) as HTMLInputElement;

    fireEvent.change(pill, { target: { checked: false } });
    fireEvent.change(palette, { target: { checked: true } });

    expect(set).toHaveBeenNthCalledWith(1, {
      surfaces: { pill: false, palette: false },
    });
    expect(set).toHaveBeenNthCalledWith(2, {
      surfaces: { pill: false, palette: true },
    });

    const final = {
      ...DEFAULT_SETTINGS,
      surfaces: { pill: false, palette: true },
    };
    first.resolve({ ...DEFAULT_SETTINGS, surfaces: { pill: false, palette: false } });
    second.resolve(final);
    await waitFor(() => expect(palette.checked).toBe(true));
  });

  it("rolls the newest failed toggle back to the latest confirmed toggle", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const saves = [first, second];
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => saves.shift()!.promise),
      subscribe: () => () => {},
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const pill = (await waitFor(() => r.getByLabelText(/floating pill/i))) as HTMLInputElement;
    const palette = r.getByLabelText(/command palette/i) as HTMLInputElement;

    fireEvent.change(pill, { target: { checked: false } });
    fireEvent.change(palette, { target: { checked: true } });
    first.resolve({ ...DEFAULT_SETTINGS, surfaces: { pill: false, palette: false } });
    second.reject(new Error("write failed"));

    await waitFor(() => {
      expect(pill.checked).toBe(false);
      expect(palette.checked).toBe(false);
      expect(r.getByRole("alert").textContent).toMatch(/could not save/i);
    });
  });

  it("adopts an earlier save when a later write fails first", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const saves = [first, second];
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => saves.shift()!.promise),
      subscribe: () => () => {},
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const pill = (await waitFor(() => r.getByLabelText(/floating pill/i))) as HTMLInputElement;
    const palette = r.getByLabelText(/command palette/i) as HTMLInputElement;

    fireEvent.change(pill, { target: { checked: false } });
    fireEvent.change(palette, { target: { checked: true } });
    second.reject(new Error("write failed"));
    await waitFor(() => expect(r.getByRole("alert")).toBeTruthy());
    first.resolve({ ...DEFAULT_SETTINGS, surfaces: { pill: false, palette: false } });

    await waitFor(() => {
      expect(pill.checked).toBe(false);
      expect(palette.checked).toBe(false);
      expect(r.queryByRole("alert")).toBeNull();
    });
  });

  it("keeps a distinct external snapshot over pending local toggles", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const saves = [first, second];
    let emit!: (snapshot: LassoSettings) => void;
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => saves.shift()!.promise),
      subscribe(cb) {
        emit = cb;
        return () => {};
      },
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const pill = (await waitFor(() => r.getByLabelText(/floating pill/i))) as HTMLInputElement;
    const palette = r.getByLabelText(/command palette/i) as HTMLInputElement;

    fireEvent.change(pill, { target: { checked: false } });
    fireEvent.change(palette, { target: { checked: true } });
    emit(DEFAULT_SETTINGS);
    first.resolve({ ...DEFAULT_SETTINGS, surfaces: { pill: false, palette: false } });
    second.reject(new Error("write failed"));

    await waitFor(() => {
      expect(pill.checked).toBe(true);
      expect(palette.checked).toBe(false);
    });
  });

  it("keeps a matching subscribed write when its promise rejects later", async () => {
    const save = deferred<LassoSettings>();
    let emit!: (snapshot: LassoSettings) => void;
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => save.promise),
      subscribe(callback) {
        emit = callback;
        return () => {};
      },
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const palette = (await waitFor(() => r.getByLabelText(/command palette/i))) as HTMLInputElement;
    fireEvent.change(palette, { target: { checked: true } });
    const confirmed = { ...DEFAULT_SETTINGS, surfaces: { pill: true, palette: true } };
    emit(confirmed);
    save.reject(new Error("late rejection"));

    await waitFor(() => expect(palette.checked).toBe(true));
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("ignores an external snapshot that arrives after unmount", async () => {
    let emit!: (snapshot: LassoSettings) => void;
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(async () => DEFAULT_SETTINGS),
      subscribe(cb) {
        emit = cb;
        return () => {};
      },
    };
    const r = render(<SurfaceOptions settings={settings} />);
    await waitFor(() => r.getByLabelText(/command palette/i));
    r.unmount();

    expect(() => emit({ ...DEFAULT_SETTINGS, paletteHotkey: "alt+p" })).not.toThrow();
  });

  it("ignores a subscription confirmation for a save older than the latest confirmed", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const saves = [first, second];
    let emit!: (snapshot: LassoSettings) => void;
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => saves.shift()!.promise),
      subscribe(cb) {
        emit = cb;
        return () => {};
      },
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const field = (await waitFor(() => r.getByLabelText(/palette hotkey/i))) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "mod+k" } }); // revision 1 (older save)
    fireEvent.change(field, { target: { value: "ctrl+shift+k" } }); // revision 2 (newer save)

    // The newer save confirms first, lifting latestConfirmedSave to revision 2.
    second.resolve({ ...DEFAULT_SETTINGS, paletteHotkey: "ctrl+shift+k" });
    await waitFor(() => expect(field.value).toBe("ctrl+shift+k"));

    // A late subscription confirmation for the OLDER save (revision 1) must be dropped.
    emit({ ...DEFAULT_SETTINGS, paletteHotkey: "mod+k" });
    await Promise.resolve();

    expect(field.value).toBe("ctrl+shift+k");
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("does not clobber a newer local edit when an older save is confirmed", async () => {
    const first = deferred<LassoSettings>();
    const second = deferred<LassoSettings>();
    const saves = [first, second];
    let emit!: (snapshot: LassoSettings) => void;
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => saves.shift()!.promise),
      subscribe(cb) {
        emit = cb;
        return () => {};
      },
    };
    const r = render(<SurfaceOptions settings={settings} />);
    const field = (await waitFor(() => r.getByLabelText(/palette hotkey/i))) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "mod+k" } }); // revision 1 (older save)
    fireEvent.change(field, { target: { value: "ctrl+shift+k" } }); // revision 2 (live draft)

    // The older save is confirmed by subscription while the live draft sits at revision 2.
    emit({ ...DEFAULT_SETTINGS, paletteHotkey: "mod+k" });
    await Promise.resolve();

    // The confirmed-but-stale snapshot must not overwrite the newer local edit.
    expect(field.value).toBe("ctrl+shift+k");
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("does not show a load error when a superseded initial read fails", async () => {
    const read = deferred<LassoSettings>();
    let emit!: (snapshot: LassoSettings) => void;
    const settings: SettingsStore = {
      get: () => read.promise,
      set: async () => DEFAULT_SETTINGS,
      subscribe(cb) {
        emit = cb;
        return () => {};
      },
    };
    const r = render(<SurfaceOptions settings={settings} />);
    // A distinct external snapshot advances the draft revision before the read settles.
    emit({ ...DEFAULT_SETTINGS, paletteHotkey: "alt+p" });
    read.reject(new Error("read failed"));

    const field = (await waitFor(() => r.getByLabelText(/palette hotkey/i))) as HTMLInputElement;
    expect(field.value).toBe("alt+p");
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("ignores a pending save that settles after the settings prop changes", async () => {
    const save = deferred<LassoSettings>();
    const first: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: vi.fn(() => save.promise),
      subscribe: () => () => {},
    };
    const second: SettingsStore = {
      get: async () => ({ ...DEFAULT_SETTINGS, paletteHotkey: "alt+p" }),
      set: vi.fn(async () => DEFAULT_SETTINGS),
      subscribe: () => () => {},
    };
    const r = render(<SurfaceOptions settings={first} />);
    const palette = (await waitFor(() => r.getByLabelText(/command palette/i))) as HTMLInputElement;
    fireEvent.change(palette, { target: { checked: true } }); // queues a pending save on `first`

    r.rerender(<SurfaceOptions settings={second} />);
    const field = (await waitFor(() => r.getByLabelText(/palette hotkey/i))) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("alt+p"));

    // The stale save resolves after the store swap: cleanup finds no matching request.
    save.resolve({ ...DEFAULT_SETTINGS, surfaces: { pill: true, palette: true } });
    await Promise.resolve();
    await Promise.resolve();

    expect(field.value).toBe("alt+p");
    expect(r.queryByRole("alert")).toBeNull();
  });

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

  it("keeps invalid and colliding palette hotkeys as a local draft", async () => {
    const settings = createSettings(memoryArea());
    const r = render(<SurfaceOptions settings={settings} />);
    const field = (await waitFor(() => r.getByLabelText(/palette hotkey/i))) as HTMLInputElement;
    const before = (await settings.get()).paletteHotkey;
    fireEvent.change(field, { target: { value: "f" } });
    expect(r.getByRole("alert").textContent).toMatch(/Ctrl, Meta, Mod, or Alt/);
    expect((await settings.get()).paletteHotkey).toBe(before);
    fireEvent.change(field, { target: { value: "Alt+n" } });
    expect(r.getByRole("alert").textContent).toMatch(/already used/i);
    expect((await settings.get()).paletteHotkey).toBe(before);
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
