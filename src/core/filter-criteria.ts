import type { CriterionId, Family, LinkDest } from "@/core/filter-types";

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

/** One filterable criterion: its id, family, UI group, and the labels surfaces show. */
export interface CriterionDef {
  id: CriterionId;
  family: Family;
  /** Heading the chip is grouped under in the <FilterPanel>. */
  group: string;
  /** Full label — panel chip + aria-label. */
  label: string;
  /** Short label for the palette's "Only · …" / "Hide · …" rows. */
  short: string;
}

const KIND: ReadonlyArray<{ value: string; label: string }> = [
  { value: "text", label: "Text" },
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
  { value: "quote", label: "Quote" },
  { value: "link", label: "Link" },
];

/**
 * The single source of truth for the filter criteria catalog (spec §4/§5). Every
 * surface — the panel chips, the command palette, the Options editors — derives
 * its lists from here, so adding a criterion touches exactly one place and the
 * "kind:video"-style ids never get re-typed by hand across files.
 */
export const CRITERIA: readonly CriterionDef[] = [
  ...KIND.map(
    (k): CriterionDef => ({
      id: `kind:${k.value}`,
      family: "kind",
      group: "Type",
      label: k.label,
      short: k.value,
    }),
  ),
  ...(Object.keys(LINK_DEST_LABELS) as LinkDest[]).map(
    (dest): CriterionDef => ({
      id: `linkDest:${dest}`,
      family: "linkDest",
      group: "Links",
      label: LINK_DEST_LABELS[dest],
      short: LINK_DEST_LABELS[dest],
    }),
  ),
  { id: "role:repost", family: "role", group: "Source", label: "Repost", short: "Repost" },
  // Bookmarked is intentionally omitted — this X build renders no inline bookmark
  // button, so there is no DOM signal to read (see verify-filter-dom.md). Deferred
  // to a GraphQL-bookmarks follow-up.
  {
    id: "engagement:liked",
    family: "engagement",
    group: "Engagement",
    label: "Liked",
    short: "Liked",
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
