/**
 * The Filter's DOM-attribute contract (ADR-0010): the `data-lasso-*` markers
 * the live-timeline applier (filter-applier.ts) writes onto cells/stubs and
 * the page-injected collapse CSS (filter-feature.ts's COLLAPSE_CSS) selects
 * on. One shared source so the two can't silently drift apart.
 */
export const FilterAttributes = {
  /** Cell is collapsed by the Filter. Prod CSS keys the visual collapse on this. */
  FILTERED: "data-lasso-filtered",
  /** Marks the injected stub element so we can find/remove it. */
  STUB: "data-lasso-filter-stub",
  /** Page-level compact-mode flag (popup toggle): CSS drops the stub for every collapsed cell. */
  COMPACT: "data-lasso-compact",
} as const;
