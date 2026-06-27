import { effect } from "@preact/signals-core";

import { FacetSelectors, Selectors } from "@/content/selectors";
import type { FilterStore } from "@/core/filter-store";
import { decide } from "@/core/timeline-filter";
import * as tweetRead from "@/core/tweet-read";

/** Cell is collapsed by the Filter. Prod CSS keys the visual collapse on this. */
const FILTERED = "data-lasso-filtered";
/**
 * User clicked "show" on the stub — an explicit per-cell un-hide that survives
 * reapply. Its VALUE is the tweet's identity at click time: X recycles cells, so
 * the override is honoured only while the cell still holds the same post (without
 * this, a recycled cell silently leaks "show" onto a different, filtered tweet).
 */
const SHOW = "data-lasso-show";
/** Marks the injected stub element so we can find/remove it. */
const STUB = "data-lasso-filter-stub";
/** The acted-on action-bar button whose appearance/flip means "Owner just liked". */
const ENGAGEMENT_SEL = FacetSelectors.LIKED;

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
  /** Tear down the store effect + lazy-media observer (route teardown / unmount). */
  dispose(): void;
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

  function collapse(cell: Element, article: Element): void {
    if (cell.hasAttribute(FILTERED)) return;
    cell.setAttribute(FILTERED, "");
    const stub = document.createElement("div");
    stub.setAttribute(STUB, "");
    stub.setAttribute("role", "button");
    stub.setAttribute("tabindex", "0");
    stub.textContent = "· hidden — show";
    stub.addEventListener("click", () => {
      // Stamp the override with *this* tweet's identity so it can't outlive the
      // cell being recycled to a different post.
      cell.setAttribute(SHOW, tweetRead.identity(article));
      restore(cell);
    });
    cell.prepend(stub);
  }

  function classify(article: Element): void {
    try {
      const cell = article.closest(Selectors.CELL);
      if (!cell) return;
      if (!inScope() || !store.state.value.enabled || store.revealed.value) {
        restore(cell);
        return;
      }
      const shown = cell.getAttribute(SHOW);
      if (shown !== null) {
        if (shown === tweetRead.identity(article)) {
          restore(cell); // same post the user un-hid — honour the override
          return;
        }
        cell.removeAttribute(SHOW); // recycled to a different tweet — drop it, re-decide
      }
      if (decide(tweetRead.facets(article), store.state.value) === "hide") collapse(cell, article);
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

  // The compact-mode flag is a page-level CSS hook (filter-feature.ts hides the
  // stub when present), so it lives on an ancestor of every cell: documentElement
  // in prod (root === document) or the scan root itself in tests.
  const compactFlagHost: Element | null =
    "documentElement" in root ? (root as Document).documentElement : (root as Element);

  // React to filter changes: chip cycle, language toggle, master enable, the
  // compact-mode toggle, and the transient "show all" reveal (read each signal so
  // the effect re-runs). Compact is a CSS-driven flag — flipping it restyles the
  // existing stubs instantly, with no per-cell reclassification needed.
  const disposeEffect = effect(() => {
    const state = store.state.value;
    void store.revealed.value;
    compactFlagHost?.toggleAttribute("data-lasso-compact", state.compactHidden);
    reapplyAll();
  });

  // Two live-DOM swaps need a re-classify of an already-seen article:
  //  (1) X hydrates a tweet's video player LAZILY: for the first beat after a cell
  //      mounts, a video post is just a `tweetPhoto` poster — byte-for-byte like a
  //      photo (verify-filter-virtualization-dom.md). Classified once on mount, it
  //      reads hasVideo:false and (under "video only") collapses / (under "video
  //      hide") wrongly shows. So re-classify when its player hydrates in.
  //  (2) The Owner likes a post WHILE reading it: the action-bar like button's
  //      testid flips (like→unlike) so under "hide: liked" the post must collapse
  //      live. X may flip the testid in place (an `attributes` mutation) or swap the
  //      button node (a `childList` add); watching both is a superset that is correct
  //      either way (design §B2). This is X's own action, never a Filter command —
  //      it stays OUT of the conductor/undo (design §B3).
  const observeTarget: Element | null =
    "documentElement" in root ? (root as Document).body : (root as Element);
  const hydrationObserver = new MutationObserver((mutations) => {
    const touched = new Set<Element>();
    for (const m of mutations) {
      if (m.type === "attributes") {
        const article = (m.target as Element).closest(Selectors.TWEET);
        if (article) touched.add(article);
        continue;
      }
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        const player = node.matches(FacetSelectors.VIDEO)
          ? node
          : node.querySelector(FacetSelectors.VIDEO);
        const article = player?.closest(Selectors.TWEET);
        if (article) touched.add(article);
        // Node-replacement form of a like/bookmark toggle.
        const acted = node.matches(ENGAGEMENT_SEL) ? node : node.querySelector(ENGAGEMENT_SEL);
        const actedArticle = acted?.closest(Selectors.TWEET);
        if (actedArticle) touched.add(actedArticle);
      }
    }
    for (const article of touched) classify(article);
  });
  if (observeTarget)
    hydrationObserver.observe(observeTarget, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-testid"],
    });

  return {
    classify,
    reapplyAll,
    restoreAll,
    hiddenCount: () => root.querySelectorAll(`[${FILTERED}]`).length,
    isStubbed: (cell) => cell.hasAttribute(FILTERED),
    dispose() {
      disposeEffect();
      hydrationObserver.disconnect();
    },
  };
}
