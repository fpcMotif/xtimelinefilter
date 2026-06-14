import { createElement, render, type VNode } from "preact";

/** Props vary per surface, so the registry stores loosely-typed trees. */
type AnyVNode = VNode<any>;

import type { FilterStore } from "@/core/filter-store";
import type { LassoSettings, SettingsStore } from "@/core/settings";
import { FilterBar } from "@/ui/filter-bar";
import { FunnelPill } from "@/ui/funnel-pill";

export interface SurfaceMountDeps {
  /** Where surfaces render — the open Shadow DOM root in prod, a detached element in tests. */
  root: ShadowRoot | Element;
  store: FilterStore;
  settings: SettingsStore;
  hiddenCount: () => number;
  inScope: () => boolean;
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
 * Surface manager (spec §3/§5/§7): reads `settings.surfaces`, mounts each enabled
 * in-page surface (funnel pill / sticky bar) into the Shadow root, persists pill
 * position back to settings, and reconciles on settings change + SPA route change.
 * Everything tears down when `inScope()` is false — the filter only shows on Home
 * and List timelines.
 */
export function mountFilterSurfaces(deps: SurfaceMountDeps): SurfaceManager {
  const { root, store, settings, hiddenCount } = deps;

  const registry: Record<string, SurfaceDef> = {
    pill: {
      enabled: (s) => s.surfaces.pill,
      view: (d, s) =>
        createElement(FunnelPill, {
          store,
          hiddenCount,
          position: s.pillPosition,
          onPositionChange: (pillPosition) => void settings.set({ pillPosition }),
        }),
    },
    bar: {
      enabled: (s) => s.surfaces.bar,
      view: () => createElement(FilterBar, { store, hiddenCount }),
    },
    // task-012 appends a "palette" entry here.
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
      for (const node of mounts.values()) {
        render(null, node);
        node.remove();
      }
      mounts.clear();
    },
  };
}
