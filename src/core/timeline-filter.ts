import { CRITERIA_BY_ID } from "@/core/filter-criteria";
import type { CriterionId, Facets, Family, FilterState, FilterVerdict } from "@/core/filter-types";

/** X language codes that mean "no real language" — these pass the language gate. */
const UNDETECTABLE = new Set(["und", "zxx", "qme", "qst", "qht", "qct", "qam"]);

/* v8 ignore next 2 -- split[0] is always present; ?. and ?? "" are type-required, runtime-dead guards */
const normalizeLang = (lang: string): string => lang.split("-")[0]?.toLowerCase() ?? "";
const isDetectable = (lang: string | null): lang is string =>
  !!lang && !UNDETECTABLE.has(normalizeLang(lang));

// "language" is the single onlyMyLanguages gate in v1, handled in decide(), not as a criterion.
function matchesCriterion(id: CriterionId, f: Facets, state: FilterState): boolean {
  return CRITERIA_BY_ID.get(id)?.matches(f, state) ?? false;
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
    const criterion = CRITERIA_BY_ID.get(id);
    if (!criterion) continue;
    const { family: fam } = criterion;
    const ids = onlyByFamily.get(fam) ?? [];
    ids.push(criterion.id);
    onlyByFamily.set(fam, ids);
  }
  for (const ids of onlyByFamily.values()) {
    if (!ids.some((id) => matchesCriterion(id, facets, state))) return "hide";
  }

  // 4. Otherwise show.
  return "show";
}
