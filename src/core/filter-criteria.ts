import type { CriterionId, Facets, FilterState, Family, LinkDest } from "@/core/filter-types";
import { classifyHost } from "@/core/link-classifier";

/**
 * Display names for each link destination — the one catalog of dest labels,
 * consumed by the criteria below, the command palette, and the Options link-rules
 * editor (so a renamed/added destination changes in exactly one place).
 */
export const LINK_DEST_LABELS: Record<LinkDest, string> = {
  arxiv: "arXiv",
  hn: "Hacker News",
  reddit: "Reddit",
  youtube: "YouTube",
  github: "GitHub",
  article: "Article/Blog",
};

/**
 * One filterable criterion: its id, family, UI group, the labels surfaces show,
 * and the matcher that decides whether a post's facets satisfy it. The catalog
 * owns matching — timeline-filter.ts is just a lookup over {@link CRITERIA_BY_ID}.
 * A criterion sourced from a facet the engine doesn't yet read (e.g. a future
 * GraphQL-backed "bookmarked") only ever grows this file plus filter-types.ts.
 */
export interface CriterionDef {
  id: CriterionId;
  family: Family;
  /** Heading the chip is grouped under in the <FilterPanel>. */
  group: string;
  /** Full label — panel chip + aria-label. */
  label: string;
  /** Short label for the palette's "Only · …" / "Hide · …" rows. */
  short: string;
  /** Whether a post's facets satisfy this criterion under the given filter state. */
  matches(facets: Facets, state: FilterState): boolean;
}

const KIND_MATCHERS: Record<string, (f: Facets) => boolean> = {
  text: (f) => f.hasText && !f.hasPhoto && !f.hasVideo && !f.hasQuote && !f.hasLink,
  photo: (f) => f.hasPhoto,
  video: (f) => f.hasVideo,
  quote: (f) => f.hasQuote,
  link: (f) => f.hasLink,
};

const KIND: ReadonlyArray<{ value: string; label: string }> = [
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
  { value: "quote", label: "Quote" },
  { value: "link", label: "Link" },
];

/**
 * The single source of truth for the filter criteria catalog (spec §4/§5). Every
 * surface — the panel chips, the command palette, the Options editors, the
 * decide() engine — derives its lists (and its matching) from here, so adding a
 * criterion touches exactly one place and the "kind:video"-style ids never get
 * re-typed by hand across files.
 */
export const CRITERIA: readonly CriterionDef[] = [
  ...KIND.map(
    (k): CriterionDef => ({
      id: `kind:${k.value}`,
      family: "kind",
      group: "Type",
      label: k.label,
      short: k.value,
      matches: KIND_MATCHERS[k.value]!,
    }),
  ),
  ...(Object.keys(LINK_DEST_LABELS) as LinkDest[]).map(
    (dest): CriterionDef => ({
      id: `linkDest:${dest}`,
      family: "linkDest",
      group: "Links",
      label: LINK_DEST_LABELS[dest],
      short: LINK_DEST_LABELS[dest],
      matches: (f, state) =>
        f.hasLink && f.linkHosts.some((h) => classifyHost(h, state.linkRules) === dest),
    }),
  ),
  {
    id: "role:repost",
    family: "role",
    group: "Source",
    label: "Repost",
    short: "Repost",
    matches: (f) => f.role === "repost",
  },
  // Bookmarked is intentionally omitted — this X build renders no inline bookmark
  // button, so there is no DOM signal to read (see verify-filter-dom.md). Deferred
  // to a GraphQL-bookmarks follow-up.
  {
    id: "engagement:liked",
    family: "engagement",
    group: "Engagement",
    label: "Liked",
    short: "Liked",
    matches: (f) => f.liked,
  },
];

/**
 * Criteria grouped for the panel, preserving first-seen group order
 * (Type → Links → Source). Built once from {@link CRITERIA}.
 */
export const CRITERIA_GROUPS: ReadonlyArray<{ group: string; criteria: CriterionDef[] }> = (() => {
  const order: string[] = [];
  const byGroup = new Map<string, CriterionDef[]>();
  for (const c of CRITERIA) {
    if (!byGroup.has(c.group)) {
      byGroup.set(c.group, []);
      order.push(c.group);
    }
    byGroup.get(c.group)!.push(c);
  }
  return order.map((group) => ({ group, criteria: byGroup.get(group)! }));
})();

/** Catalog lookup by id — the engine's only entry point into criterion matching. */
export const CRITERIA_BY_ID: ReadonlyMap<CriterionId, CriterionDef> = new Map(
  CRITERIA.map((c) => [c.id, c]),
);
