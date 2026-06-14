import type { CriterionId, Facets, Family, FilterState, FilterVerdict } from "@/core/filter-types";
import { classifyHost } from "@/core/link-classifier";

/** X language codes that mean "no real language" — these pass the language gate. */
const UNDETECTABLE = new Set(["und", "zxx", "qme", "qst", "qht", "qct", "qam"]);

const normalizeLang = (lang: string): string => lang.split("-")[0]?.toLowerCase() ?? "";
const isDetectable = (lang: string | null): lang is string =>
  !!lang && !UNDETECTABLE.has(normalizeLang(lang));

const familyOf = (id: CriterionId): Family => id.split(":")[0] as Family;

function matchesKind(value: string, f: Facets): boolean {
  switch (value) {
    case "text":
      return f.hasText && !f.hasPhoto && !f.hasVideo && !f.hasQuote && !f.hasLink;
    case "photo":
      return f.hasPhoto;
    case "video":
      return f.hasVideo;
    case "quote":
      return f.hasQuote;
    case "link":
      return f.hasLink;
    default:
      return false;
  }
}

function matchesCriterion(id: CriterionId, f: Facets, state: FilterState): boolean {
  const [family, value] = id.split(":");
  if (!value) return false;
  switch (family) {
    case "kind":
      return matchesKind(value, f);
    case "linkDest":
      return f.hasLink && f.linkHosts.some((h) => classifyHost(h, state.linkRules) === value);
    case "role":
      return value === "repost" && f.role === "repost";
    // "language" is the single onlyMyLanguages gate in v1, handled in decide(), not as a criterion.
    default:
      return false;
  }
}

/**
 * The §4 semantics engine. Order is load-bearing: hide-wins → language gate →
 * only (AND across families, OR within) → show. Pure; fails open (an unclassified
 * post, or a post with no detectable language, shows).
 */
export function decide(facets: Facets, state: FilterState): FilterVerdict {
  // 1. Hide wins.
  for (const [id, mode] of Object.entries(state.criteria)) {
    if (mode === "hide" && matchesCriterion(id, facets, state)) return "hide";
  }

  // 2. Language gate.
  if (state.onlyMyLanguages && isDetectable(facets.lang)) {
    if (!state.myLanguages.includes(normalizeLang(facets.lang))) return "hide";
  }

  // 3. Only — a whitelist: AND across families that have any "only", OR within each.
  const onlyByFamily = new Map<Family, CriterionId[]>();
  for (const [id, mode] of Object.entries(state.criteria)) {
    if (mode !== "only") continue;
    const fam = familyOf(id);
    const ids = onlyByFamily.get(fam) ?? [];
    ids.push(id);
    onlyByFamily.set(fam, ids);
  }
  for (const ids of onlyByFamily.values()) {
    if (!ids.some((id) => matchesCriterion(id, facets, state))) return "hide";
  }

  // 4. Otherwise show.
  return "show";
}
