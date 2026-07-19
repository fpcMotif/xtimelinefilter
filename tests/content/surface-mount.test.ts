import { describe, expect, it, vi } from "vitest";

import { mountFilterSurfaces } from "@/content/surface-mount";
import { createFilterStore } from "@/core/filter-store";
import { DEFAULT_SETTINGS, type LassoSettings, type SettingsStore } from "@/core/settings";

/**
 * In-memory SettingsStore that mirrors createSettings' contract: get() resolves
 * the current snapshot, set() merges + notifies subscribers synchronously.
 */
function fakeSettings(initial: Partial<LassoSettings> = {}): SettingsStore & {
  snapshot: LassoSettings;
} {
  const subs = new Set<(s: LassoSettings) => void>();
  let snapshot: LassoSettings = { ...DEFAULT_SETTINGS, ...initial };
  return {
    get snapshot() {
      return snapshot;
    },
    async get() {
      return snapshot;
    },
    set: vi.fn(async (patch: Partial<LassoSettings>) => {
      snapshot = { ...snapshot, ...patch };
      for (const cb of subs) cb(snapshot);
      return snapshot;
    }),
    subscribe(cb: (s: LassoSettings) => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

const pillIn = (root: Element) => root.querySelector("[data-funnel-pill-root]");
const paletteIn = (root: Element) =>
  root.querySelector('[role="dialog"][aria-label="Filter command palette"]');

/** Let the manager settle its initial async settings.get(). */
const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mountFilterSurfaces", () => {
  it("keeps a subscription event newer than a pending initial read", async () => {
    const root = document.createElement("div");
    const read = deferred<LassoSettings>();
    let emit!: (s: LassoSettings) => void;
    const newer = {
      ...DEFAULT_SETTINGS,
      surfaces: { pill: false, palette: true },
      paletteHotkey: "alt+p",
    };
    const settings: SettingsStore = {
      get: () => {
        // A storage event can fire synchronously as get() starts. The listener
        // must already exist, or this event is lost.
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

    const manager = mountFilterSurfaces({
      root,
      store: createFilterStore({ navLanguages: ["ja"] }),
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    read.resolve({ ...DEFAULT_SETTINGS, surfaces: { pill: true, palette: false } });
    await flush();

    expect(pillIn(root)).toBeNull();
    expect(manager.paletteHotkey()).toBe("alt+p");
    manager.unmount();
  });

  it("keeps listening after the initial read fails", async () => {
    const root = document.createElement("div");
    const read = deferred<LassoSettings>();
    let emit!: (s: LassoSettings) => void;
    const settings: SettingsStore = {
      get: async () => read.promise,
      set: async () => DEFAULT_SETTINGS,
      subscribe(cb) {
        emit = cb;
        return () => {};
      },
    };

    const manager = mountFilterSurfaces({
      root,
      store: createFilterStore({ navLanguages: ["ja"] }),
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    read.reject(new Error("storage unavailable"));
    await flush();
    emit({ ...DEFAULT_SETTINGS, surfaces: { pill: true, palette: false } });

    expect(pillIn(root)).toBeTruthy();
    manager.unmount();
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("write failed");
      },
    ],
    ["rejects", () => Promise.reject(new Error("write failed"))],
  ])("absorbs cosmetic pill-position saves when settings.set %s", async (_kind, fail) => {
    const root = document.createElement("div");
    const settings: SettingsStore = {
      get: async () => DEFAULT_SETTINGS,
      set: fail as SettingsStore["set"],
      subscribe: () => () => {},
    };
    const manager = mountFilterSurfaces({
      root,
      store: createFilterStore({ navLanguages: ["ja"] }),
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    await flush();
    const button = root.querySelector("[data-funnel-pill-root] button") as HTMLElement;
    button.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 40, clientY: 60, bubbles: true }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 120, clientY: 140, bubbles: true }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 120, clientY: 140, bubbles: true }),
    );
    await flush();

    expect(button).toBeTruthy();
    manager.unmount();
  });

  it("mounts only enabled in-page surfaces, persists pill position, and tears down out of scope", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({
      surfaces: { pill: true, palette: false },
      pillPosition: { x: 40, y: 60 },
    });
    let scope = true;

    const manager = mountFilterSurfaces({
      root,
      store,
      settings,
      hiddenCount: () => 0,
      inScope: () => scope,
    });
    await flush();

    // pill: true, in scope → funnel pill present.
    expect(pillIn(root)).toBeTruthy();

    // The pill reports a new position → settings.set called with pillPosition.
    const onPositionChange = (root.querySelector("[data-funnel-pill-root] button") as HTMLElement)!;
    expect(onPositionChange).toBeTruthy();
    const pillButton = onPositionChange as HTMLButtonElement;
    pillButton.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 40,
        clientY: 60,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 120,
        clientY: 140,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 120,
        clientY: 140,
        bubbles: true,
      }),
    );
    expect(settings.set).toHaveBeenCalled();
    const posCall = (settings.set as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => "pillPosition" in (c[0] as object),
    );
    expect(posCall).toBeTruthy();
    const pos = (posCall![0] as { pillPosition: { x: number; y: number } }).pillPosition;
    expect(pos.x).toBeGreaterThan(40);
    expect(pos.y).toBeGreaterThan(60);

    // Disabling the pill surface tears it down on the next reconcile.
    await settings.set({ surfaces: { pill: false, palette: false } });
    manager.update();
    expect(pillIn(root)).toBeNull();

    // Re-enable, then leaving scope tears every surface down.
    await settings.set({ surfaces: { pill: true, palette: false } });
    manager.update();
    expect(pillIn(root)).toBeTruthy();
    scope = false;
    manager.update();
    expect(pillIn(root)).toBeNull();

    manager.unmount();
  });

  it("exposes live palette intents and drops them when surfaces.palette is disabled", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({
      surfaces: { pill: false, palette: true },
      paletteHotkey: "mod+shift+f",
    });

    const manager = mountFilterSurfaces({
      root,
      store,
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    await flush();

    // No overlay until the hotkey fires.
    expect(paletteIn(root)).toBeNull();
    expect(manager.isPaletteOpen()).toBe(false);

    expect(manager.paletteHotkey()).toBe("mod+shift+f");
    expect(manager.togglePalette()).toBe(true);
    expect(paletteIn(root)).toBeTruthy();
    expect(manager.isPaletteOpen()).toBe(true);

    expect(manager.dismiss()).toBe(true);
    expect(paletteIn(root)).toBeNull();
    expect(manager.isPaletteOpen()).toBe(false);

    // Disabling the surface tears down its keyboard intent.
    await settings.set({ surfaces: { pill: false, palette: false } });
    manager.update();
    expect(manager.paletteHotkey()).toBeNull();
    expect(manager.togglePalette()).toBe(false);
    expect(manager.isPaletteOpen()).toBe(false);
    expect(paletteIn(root)).toBeNull();

    manager.unmount();
  });

  it("dismisses an open pill after the palette is closed", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const manager = mountFilterSurfaces({
      root,
      store: createFilterStore({ navLanguages: ["ja"] }),
      settings: fakeSettings({ surfaces: { pill: true, palette: false } }),
      hiddenCount: () => 0,
      inScope: () => true,
    });
    await flush();

    (root.querySelector("[data-funnel-pill-root] button") as HTMLElement).click();
    await flush();
    expect(root.querySelector('[role="dialog"]')).toBeTruthy();
    expect(manager.dismiss()).toBe(true);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(manager.dismiss()).toBe(false);
    manager.unmount();
  });

  it("returns the live explicit combo and closes via the overlay backdrop", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({
      surfaces: { pill: false, palette: true },
      paletteHotkey: "ctrl+shift+k",
    });

    const manager = mountFilterSurfaces({
      root,
      store,
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    await flush();

    expect(manager.paletteHotkey()).toBe("ctrl+shift+k");
    expect(manager.togglePalette()).toBe(true);
    const overlay = paletteIn(root);
    expect(overlay).toBeTruthy();

    // Outside-click on the backdrop (target === currentTarget) fires the palette's
    // onClose → the manager clears paletteOpen and re-renders it away.
    const backdrop = root.querySelector('[role="presentation"]') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(paletteIn(root)).toBeNull();

    manager.unmount();
  });

  it("does not install a document keydown listener", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({
      surfaces: { pill: false, palette: true },
      paletteHotkey: "mod+shift+f",
    });

    const manager = mountFilterSurfaces({
      root,
      store,
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    await flush();

    // The keyboard coordinator owns keydown. The manager remains closed.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", shiftKey: true, bubbles: true }),
    );
    expect(paletteIn(root)).toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(paletteIn(root)).toBeNull();

    manager.unmount();
  });

  it("exposes an explicit alt+shift combo", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({
      surfaces: { pill: false, palette: true },
      paletteHotkey: "alt+shift+p",
    });

    const manager = mountFilterSurfaces({
      root,
      store,
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    await flush();

    expect(manager.paletteHotkey()).toBe("alt+shift+p");
    manager.togglePalette();
    expect(paletteIn(root)).toBeTruthy();

    manager.unmount();
  });

  it("update() after unmount() is a no-op (disposed guard)", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({ surfaces: { pill: true, palette: false } });

    const manager = mountFilterSurfaces({
      root,
      store,
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    await flush();
    manager.unmount();
    expect(() => manager.update()).not.toThrow(); // reconcile returns early when disposed
    expect(manager.dismiss()).toBe(false);
    expect(pillIn(root)).toBeNull();
  });

  it("tears down a still-mounted surface on unmount()", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({ surfaces: { pill: true, palette: false } });

    const manager = mountFilterSurfaces({
      root,
      store,
      settings,
      hiddenCount: () => 0,
      inScope: () => true,
    });
    await flush();
    expect(pillIn(root)).toBeTruthy(); // pill is mounted and still live

    manager.unmount(); // must render(null) + remove the live mount node
    expect(pillIn(root)).toBeNull();
    expect(root.querySelector("[data-lasso-surface]")).toBeNull();
  });
});
