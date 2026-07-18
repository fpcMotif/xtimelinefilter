import { createElement, render, type VNode } from "preact";

/** Props vary per surface, so the registry stores loosely-typed trees. */
type AnyVNode = VNode<any>;

import type { Conduct, FilterStore } from "@/core/filter-store";
import type { LassoSettings, SettingsStore } from "@/core/settings";
import { FilterPalette } from "@/ui/filter-palette";
import { FunnelPill } from "@/ui/funnel-pill";

export interface SurfaceMountDeps {
  /** Where surfaces render — the open Shadow DOM root in prod, a detached element in tests. */
  root: ShadowRoot | Element;
  store: FilterStore;
  settings: SettingsStore;
  hiddenCount: () => number;
  inScope: () => boolean;
  /** Conduct in-page Filter commands through the controller's fail-open wall (ADR-0010). */
  conduct?: Conduct;
}

export interface SurfaceManager {
  /** Re-read settings + scope and reconcile which surfaces are mounted. */
  update(): void;
  /** Tear every surface down and stop listening for changes. */
  unmount(): void;
}

/**
 * A renderer for one in-page surface, keyed by its `surfaces` flag. The registry
 * is the extension point: task-012 adds the command palette by appending an entry
 * here, without touching the reconcile loop below.
 */
interface SurfaceDef {
  /** Returns true when this surface should be mounted under the current settings. */
  enabled: (s: LassoSettings) => boolean;
  /** Build the Preact tree to render into the surface's own mount node. */
  view: (deps: SurfaceMountDeps, s: LassoSettings) => AnyVNode;
}

/**
 * Match a `KeyboardEvent` against a `"mod+shift+f"`-style combo. `mod` maps to
 * Ctrl or Meta (so the same setting works on Windows/Linux and macOS); the final
 * token is the key, compared case-insensitively.
 */
function matchesHotkey(e: KeyboardEvent, combo: string): boolean {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const key = parts[parts.length - 1];
  if (!key || e.key.toLowerCase() !== key) return false;
  const wantMod = parts.includes("mod");
  const wantCtrl = parts.includes("ctrl");
  const wantMeta = parts.includes("meta") || parts.includes("cmd");
  if (wantMod ? !(e.ctrlKey || e.metaKey) : wantCtrl !== e.ctrlKey || wantMeta !== e.metaKey)
    return false;
  if (parts.includes("shift") !== e.shiftKey) return false;
  if (parts.includes("alt") !== e.altKey) return false;
  return true;
}

/**
 * Surface manager (spec §3/§5/§7): reads `settings.surfaces`, mounts each enabled
 * in-page surface (funnel pill / command palette) into the Shadow root, persists
 * pill position back to settings, and reconciles on settings change + SPA route change.
 * Everything tears down when `inScope()` is false — the filter only shows on
 * Home, List, and profile timelines.
 */
export function mountFilterSurfaces(deps: SurfaceMountDeps): SurfaceManager {
  const { root, store, settings, hiddenCount, conduct } = deps;

  // The palette is modal and manager-driven: the configured hotkey toggles this
  // flag, the registry entry renders <FilterPalette open={…}>, and reconcile()
  // re-renders so the overlay appears/disappears.
  let paletteOpen = false;

  const registry: Record<string, SurfaceDef> = {
    pill: {
      enabled: (s) => s.surfaces.pill,
      view: (d, s) =>
        createElement(FunnelPill, {
          store,
          hiddenCount,
          conduct,
          position: s.pillPosition,
          onPositionChange: (pillPosition) => void settings.set({ pillPosition }),
        }),
    },
    palette: {
      enabled: (s) => s.surfaces.palette,
      view: () =>
        createElement(FilterPalette, {
          store,
          conduct,
          open: paletteOpen,
          onClose: () => {
            paletteOpen = false;
            reconcile();
          },
        }),
    },
  };

  // One mount node per surface key, created lazily and reused so Preact diffs
  // rather than re-creating the tree on every reconcile.
  const mounts = new Map<string, HTMLElement>();
  let current: LassoSettings | null = null;
  let disposed = false;
  let hotkeyListener: ((e: KeyboardEvent) => void) | null = null;

  function removeHotkey(): void {
    if (!hotkeyListener) return;
    document.removeEventListener("keydown", hotkeyListener);
    hotkeyListener = null;
  }

  function addHotkey(combo: string): void {
    if (hotkeyListener) return;
    hotkeyListener = (e: KeyboardEvent) => {
      if (matchesHotkey(e, combo)) {
        e.preventDefault();
        paletteOpen = !paletteOpen;
        reconcile();
        return;
      }
      // While open, Escape closes the palette here too, so closing never depends
      // on the overlay's async-mounted listener (keeps the manager authoritative).
      if (paletteOpen && e.key === "Escape") {
        paletteOpen = false;
        reconcile();
      }
    };
    document.addEventListener("keydown", hotkeyListener);
  }

  function mountNode(key: string): HTMLElement {
    let node = mounts.get(key);
    if (!node) {
      node = document.createElement("div");
      node.dataset.lassoSurface = key;
      root.appendChild(node);
      mounts.set(key, node);
    }
    return node;
  }

  function teardown(key: string): void {
    const node = mounts.get(key);
    if (!node) return;
    render(null, node);
    node.remove();
    mounts.delete(key);
  }

  function reconcile(): void {
    if (disposed) return;
    const s = current;
    const show = !!s && deps.inScope();

    // The palette hotkey lives only while the palette surface is active. Adding
    // it here (and dropping it + the open flag otherwise) means disabling
    // surfaces.palette or leaving scope removes the listener.
    const paletteActive = show && !!s && registry.palette!.enabled(s);
    if (paletteActive) addHotkey(s!.paletteHotkey);
    else {
      removeHotkey();
      paletteOpen = false;
    }

    for (const [key, def] of Object.entries(registry)) {
      if (show && s && def.enabled(s)) render(def.view(deps, s), mountNode(key));
      else teardown(key);
    }
  }

  // Seed the snapshot from storage, then keep it live via subscribe. Both paths
  // funnel through reconcile so mounting is idempotent.
  void settings.get().then((s) => {
    if (disposed) return;
    current = s;
    reconcile();
  });
  const unsubscribe = settings.subscribe((s) => {
    current = s;
    reconcile();
  });

  return {
    update: reconcile,
    unmount() {
      disposed = true;
      unsubscribe();
      removeHotkey();
      for (const node of mounts.values()) {
        render(null, node);
        node.remove();
      }
      mounts.clear();
    },
  };
}
