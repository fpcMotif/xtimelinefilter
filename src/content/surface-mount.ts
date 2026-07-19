import { createElement, render, type VNode } from "preact";

/** Props vary per surface, so the registry stores loosely-typed trees. */
type AnyVNode = VNode<any>;

import type { FilterStore } from "@/core/filter-store";
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
  conduct?: (run: (s: FilterStore) => void) => void;
}

export interface SurfaceManager {
  /** Re-read settings + scope and reconcile which surfaces are mounted. */
  update(): void;
  /** Current usable palette binding. The keyboard owns matching it. */
  paletteHotkey(): string | null;
  /** Toggle the palette when it is mounted. */
  togglePalette(): boolean;
  /** Whether the palette currently owns modal interaction. */
  isPaletteOpen(): boolean;
  /** Close the highest visible filter surface. */
  dismiss(): boolean;
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
 * Surface manager (spec §3/§5/§7): reads `settings.surfaces`, mounts each enabled
 * in-page surface (funnel pill / command palette) into the Shadow root, persists
 * pill position back to settings, and reconciles on settings change + SPA route change.
 * Everything tears down when `inScope()` is false — the filter only shows on
 * Home, List, and profile timelines.
 */
export function mountFilterSurfaces(deps: SurfaceMountDeps): SurfaceManager {
  const { root, store, settings, hiddenCount, conduct } = deps;

  // Open state belongs to this coordinator. Components only request transitions.
  let paletteOpen = false;
  let pillOpen = false;

  function persistPillPosition(pillPosition: LassoSettings["pillPosition"]): void {
    try {
      void Promise.resolve(settings.set({ pillPosition })).catch(() => {});
    } catch {
      // Position persistence is cosmetic. Keep the dragged UI position alive.
    }
  }

  const registry: Record<string, SurfaceDef> = {
    pill: {
      enabled: (s) => s.surfaces.pill,
      view: (d, s) =>
        createElement(FunnelPill, {
          store,
          hiddenCount,
          conduct,
          position: s.pillPosition,
          open: pillOpen,
          onOpenChange: (open) => {
            pillOpen = open;
            reconcile();
          },
          onPositionChange: persistPillPosition,
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

    if (!(show && s && registry.palette!.enabled(s))) paletteOpen = false;
    if (!(show && s && registry.pill!.enabled(s))) pillOpen = false;

    for (const [key, def] of Object.entries(registry)) {
      if (show && s && def.enabled(s)) render(def.view(deps, s), mountNode(key));
      else teardown(key);
    }
  }

  // Subscribe first: an onChanged event can arrive while the initial get is
  // pending. Its revision is newer authority, so the late read is discarded.
  let settingsRevision = 0;
  const unsubscribe = settings.subscribe((s) => {
    settingsRevision += 1;
    current = s;
    reconcile();
  });
  const initialRevision = settingsRevision;
  void settings
    .get()
    .then((s) => {
      if (disposed || settingsRevision !== initialRevision) return;
      current = s;
      reconcile();
    })
    // A later subscription event can still provide truth after an initial read
    // failure. Do not turn that recoverable state into an unhandled rejection.
    .catch(() => {});

  const paletteHotkey = (): string | null => {
    if (disposed || !current || !deps.inScope() || !current.surfaces.palette) return null;
    return current.paletteHotkey;
  };

  return {
    update: reconcile,
    paletteHotkey,
    togglePalette() {
      if (!paletteHotkey()) return false;
      paletteOpen = !paletteOpen;
      reconcile();
      return true;
    },
    isPaletteOpen: () => !disposed && paletteOpen,
    dismiss() {
      if (disposed) return false;
      if (paletteOpen) {
        paletteOpen = false;
        reconcile();
        return true;
      }
      if (pillOpen) {
        pillOpen = false;
        reconcile();
        return true;
      }
      return false;
    },
    unmount() {
      disposed = true;
      unsubscribe();
      for (const node of mounts.values()) {
        render(null, node);
        node.remove();
      }
      mounts.clear();
    },
  };
}
