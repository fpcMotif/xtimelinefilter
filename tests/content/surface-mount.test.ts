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

  it("opens the palette on the configured hotkey and drops the listener when surfaces.palette is disabled", async () => {
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

    // The configured combo opens the palette overlay.
    dispatchHotkey("mod+shift+f");
    expect(paletteIn(root)).toBeTruthy();

    // Escape closes it again (handled by the manager while the palette is open).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(paletteIn(root)).toBeNull();

    // Disabling the surface tears down the listener: the hotkey no longer opens it.
    await settings.set({ surfaces: { pill: false, palette: false } });
    manager.update();
    dispatchHotkey("mod+shift+f");
    expect(paletteIn(root)).toBeNull();

    manager.unmount();
  });

  it("matches an explicit ctrl+meta combo (no `mod` token) and closes via the overlay backdrop", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const store = createFilterStore({ navLanguages: ["ja"] });
    // No `mod` token → matchesHotkey takes the explicit ctrl/meta comparison branch.
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

    // A combo with the same key but the wrong modifiers must NOT open it.
    dispatchHotkey("shift+k"); // ctrl missing → explicit branch rejects
    expect(paletteIn(root)).toBeNull();

    dispatchHotkey("ctrl+shift+k");
    const overlay = paletteIn(root);
    expect(overlay).toBeTruthy();

    // Outside-click on the backdrop (target === currentTarget) fires the palette's
    // onClose → the manager clears paletteOpen and re-renders it away.
    const backdrop = root.querySelector('[role="presentation"]') as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(paletteIn(root)).toBeNull();

    manager.unmount();
  });

  it("rejects hotkeys with the wrong modifiers/shift/alt and ignores Escape while closed", async () => {
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

    // Right key, but no mod held → the `wantMod ? !(ctrl||meta)` branch rejects.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", shiftKey: true, bubbles: true }),
    );
    expect(paletteIn(root)).toBeNull();

    // Mod held but shift missing → the shift comparison rejects.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }),
    );
    expect(paletteIn(root)).toBeNull();

    // Mod+shift but alt also held → the alt comparison rejects.
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
        bubbles: true,
      }),
    );
    expect(paletteIn(root)).toBeNull();

    // Escape while the palette is closed is a no-op in the manager's listener.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(paletteIn(root)).toBeNull();

    manager.unmount();
  });

  it("matches an explicit alt+shift combo", async () => {
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

    dispatchHotkey("alt+shift+p");
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
