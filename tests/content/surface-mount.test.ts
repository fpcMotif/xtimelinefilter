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
const barIn = (root: Element) => root.querySelector('section[aria-label="Timeline filter"]');
const paletteIn = (root: Element) => root.querySelector('[role="dialog"][aria-label="Filter command palette"]');

/** Dispatch a "mod+shift+f"-style combo as a keydown on the document. */
function dispatchHotkey(combo: string) {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1]!;
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      ctrlKey: parts.includes("mod") || parts.includes("ctrl"),
      metaKey: parts.includes("meta") || parts.includes("cmd"),
      shiftKey: parts.includes("shift"),
      altKey: parts.includes("alt"),
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Let the manager settle its initial async settings.get(). */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("mountFilterSurfaces", () => {
  it("mounts only enabled in-page surfaces, persists pill position, and tears down out of scope", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({
      surfaces: { pill: true, palette: false, bar: false },
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

    // pill: true, bar: false, in scope → funnel pill present, no sticky bar.
    expect(pillIn(root)).toBeTruthy();
    expect(barIn(root)).toBeNull();

    // The pill reports a new position → settings.set called with pillPosition.
    const onPositionChange = (root.querySelector(
      "[data-funnel-pill-root] button",
    ) as HTMLElement)!;
    expect(onPositionChange).toBeTruthy();
    const pillButton = onPositionChange as HTMLButtonElement;
    pillButton.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 40, clientY: 60, bubbles: true }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 120, clientY: 140, bubbles: true }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 120, clientY: 140, bubbles: true }),
    );
    expect(settings.set).toHaveBeenCalled();
    const posCall = (settings.set as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => "pillPosition" in (c[0] as object),
    );
    expect(posCall).toBeTruthy();
    const pos = (posCall![0] as { pillPosition: { x: number; y: number } }).pillPosition;
    expect(pos.x).toBeGreaterThan(40);
    expect(pos.y).toBeGreaterThan(60);

    // Switch to bar-only and update → pill removed, sticky bar present.
    await settings.set({ surfaces: { pill: false, palette: false, bar: true } });
    manager.update();
    expect(pillIn(root)).toBeNull();
    expect(barIn(root)).toBeTruthy();

    // Out of scope → no filter surface remains mounted.
    scope = false;
    manager.update();
    expect(pillIn(root)).toBeNull();
    expect(barIn(root)).toBeNull();

    manager.unmount();
  });

  it("opens the palette on the configured hotkey and drops the listener when surfaces.palette is disabled", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    const settings = fakeSettings({
      surfaces: { pill: false, palette: true, bar: false },
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

    // The configured combo opens the palette overlay.
    dispatchHotkey("mod+shift+f");
    expect(paletteIn(root)).toBeTruthy();

    // Escape closes it again (handled by the manager while the palette is open).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(paletteIn(root)).toBeNull();

    // Disabling the surface tears down the listener: the hotkey no longer opens it.
    await settings.set({ surfaces: { pill: false, palette: false, bar: false } });
    manager.update();
    dispatchHotkey("mod+shift+f");
    expect(paletteIn(root)).toBeNull();

    manager.unmount();
  });
});
