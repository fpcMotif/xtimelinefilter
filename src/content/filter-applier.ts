import { effect } from "@preact/signals-core";

import { Selectors } from "@/content/selectors";
import type { FilterStore } from "@/core/filter-store";
import { decide } from "@/core/timeline-filter";
import { extractFacets } from "@/core/tweet-facets";

/** Cell is collapsed by the Filter. Prod CSS keys the visual collapse on this. */
const FILTERED = "data-lasso-filtered";
/** User clicked "show" on the stub — an explicit per-cell un-hide that survives reapply. */
const SHOW = "data-lasso-show";
/** Marks the injected stub element so we can find/remove it. */
const STUB = "data-lasso-filter-stub";

export interface FilterApplier {
  /** Decide + collapse/restore the article's cell. Re-decided every call (never cached). */
  classify(article: Element): void;
  /** Re-run classification over every in-scope cell (e.g. on filter-state change). */
  reapplyAll(): void;
  /** Un-collapse every cell the Filter hid (disable / route exit). */
  restoreAll(): void;
  hiddenCount(): number;
  /** A Hidden cell is inert for List-assign — overlay injection / select mode check this. */
  isStubbed(cell: Element): boolean;
}

export interface FilterApplierDeps {
  store: FilterStore;
  root: Document | Element;
  inScope: () => boolean;
}

/**
 * Applies the Filter to the live timeline: collapses non-matching cells to a
 * reversible stub (ADR-0010), never display:none, never removing nodes. Verdicts
 * are recomputed every scan (X recycles cells). Fails open — any throw leaves the
 * post shown. Never load-bearing for List-assign.
 */
export function createFilterApplier(deps: FilterApplierDeps): FilterApplier {
  const { store, root, inScope } = deps;

  function restore(cell: Element): void {
    cell.removeAttribute(FILTERED);
    cell.querySelector(`[${STUB}]`)?.remove();
  }

  function collapse(cell: Element): void {
    if (cell.hasAttribute(FILTERED)) return;
    cell.setAttribute(FILTERED, "");
    const stub = document.createElement("div");
    stub.setAttribute(STUB, "");
    stub.setAttribute("role", "button");
    stub.setAttribute("tabindex", "0");
    stub.textContent = "· hidden — show";
    stub.addEventListener("click", () => {
      cell.setAttribute(SHOW, ""); // explicit user override — survives reapply
      restore(cell);
    });
    cell.prepend(stub);
  }

  function classify(article: Element): void {
    try {
      const cell = article.closest(Selectors.CELL);
      if (!cell) return;
      if (!inScope() || !store.state.value.enabled) {
        restore(cell);
        return;
      }
      if (cell.hasAttribute(SHOW)) {
        restore(cell);
        return;
      }
      if (decide(extractFacets(article), store.state.value) === "hide") collapse(cell);
      else restore(cell);
    } catch {
      // fail-open: never hide a post we couldn't process
      const cell = article.closest?.(Selectors.CELL);
      if (cell) restore(cell);
    }
  }

  function reapplyAll(): void {
    for (const cell of root.querySelectorAll(Selectors.CELL)) {
      const article = cell.querySelector(Selectors.TWEET);
      if (article) classify(article);
    }
  }

  function restoreAll(): void {
    for (const cell of root.querySelectorAll(`[${FILTERED}]`)) restore(cell);
  }

  // React to filter-state changes (chip cycle, language toggle, master enable).
  effect(() => {
    // touch the signal so the effect re-runs on any change
    void store.state.value;
    reapplyAll();
  });

  return {
    classify,
    reapplyAll,
    restoreAll,
    hiddenCount: () => root.querySelectorAll(`[${FILTERED}]`).length,
    isStubbed: (cell) => cell.hasAttribute(FILTERED),
  };
}
