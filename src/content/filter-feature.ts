import { createFilterApplier } from "@/content/filter-applier";
import { FilterAttributes } from "@/content/filter-attributes";
import { mountFilterSurfaces, type SurfaceManager } from "@/content/surface-mount";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import type { SettingsStore } from "@/core/settings";
import { createUiRoot } from "@/ui/mount";

const { FILTERED, STUB, COMPACT, TRACELESS } = FilterAttributes;

/** The slice of the Filter the content boot path interacts with after install. */
export interface FilterFeature {
  /** Classify one article's cell — called by the tweet scanner per post. */
  classify(article: Element): void;
  /**
   * Whether a cell is collapsed by the Filter (overlay / select-mode gate).
   * Accepts either the article or its enclosing cell.
   */
  isStubbed(el: Element): boolean;
  /** Re-evaluate surfaces + re-apply collapses (call on SPA route change). */
  sync(): void;
  /** Tear down every surface and its Shadow host. */
  unmount(): void;
}

export interface FilterFeatureDeps {
  settings: SettingsStore;
  highContrast: boolean;
  /** True on Home / List / profile timelines — the Filter is inert elsewhere. */
  inScope: () => boolean;
  /** Shared filter store (so the controller conducts the same one the surfaces show); omit ⇒ the feature creates its own. */
  store?: FilterStore;
  /** Route in-page Filter commands through the controller's fail-open wall; omit ⇒ surfaces edit the store directly. */
  conduct?: (run: (s: FilterStore) => void) => void;
}

// Page-level CSS for collapse-to-stub: the cell lives in x.com's DOM, not our
// Shadow DOM, so this style goes in the page. Hiding the cell's content while
// keeping the stub's height stays gentle on X's virtualization (ADR-0010).
export const COLLAPSE_CSS =
  `[${FILTERED}] > *:not([${STUB}]){display:none !important}` +
  `[${STUB}]{display:block;padding:6px 12px;font-size:13px;color:#536471;cursor:pointer}` +
  // Compact mode (opt-in `compactHidden`, popup toggle): also drop the stub so the
  // cell collapses to ~0 height — ADR-0010's deferred upgrade, pending live-DOM
  // virtualization verification. The cell node stays in layout (never removed).
  `[${COMPACT}] [${STUB}]{display:none !important}` +
  // Per-cell traceless hide: a post hidden because the Owner already liked it drops
  // its stub regardless of compact mode ("already liked → erase it, no trace"). Same
  // safe 0-height collapse — the cell node stays in layout. Set by the applier.
  `[${TRACELESS}] [${STUB}]{display:none !important}`;

/**
 * Installs the Filter capability (ADR-0010, spec §3) as one self-contained unit:
 * the persisted store, the live-timeline applier, the in-page surfaces, and the
 * route-change sync — so the content boot path (main.tsx) just wires it to the
 * scanner instead of growing the filter's whole lifecycle inline. Display-only,
 * shares Lasso's lifecycle, and starts as a no-op (zero criteria) — the Filter
 * does nothing until the user sets a chip, and fails open.
 */
export async function installFilterFeature(deps: FilterFeatureDeps): Promise<FilterFeature> {
  const { settings, highContrast, inScope } = deps;

  const store = deps.store ?? createFilterStore();
  await store.load();

  const style = document.createElement("style");
  style.textContent = COLLAPSE_CSS;
  document.head.appendChild(style);

  const applier = createFilterApplier({ store, root: document, inScope });

  // One Shadow host for every in-page filter surface; the manager mounts the
  // enabled ones (pill / palette) into it per settings and tears them
  // down off-route.
  const surfaceRoot = createUiRoot("lasso-filter-surfaces");
  if (highContrast) surfaceRoot.host.setAttribute("data-hc", "");
  const surfaces: SurfaceManager = mountFilterSurfaces({
    root: surfaceRoot.root,
    store,
    settings,
    hiddenCount: () => applier.hiddenCount(),
    inScope,
    conduct: deps.conduct,
  });

  const sync = (): void => {
    surfaces.update();
    applier.reapplyAll();
  };
  sync();

  return {
    classify: (article) => applier.classify(article),
    isStubbed: (el) => applier.isStubbed(el),
    sync,
    unmount() {
      surfaces.unmount();
      applier.restoreAll();
      applier.dispose();
      style.remove();
      surfaceRoot.host.remove();
    },
  };
}
