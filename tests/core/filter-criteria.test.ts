import { describe, expect, it } from "vitest";

import { CRITERIA, CRITERIA_BY_ID, CRITERIA_GROUPS } from "@/core/filter-criteria";
import type { Facets, FilterState } from "@/core/filter-types";

describe("filter-criteria catalog", () => {
  it("has a unique id per entry", () => {
    const ids = CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a matcher function", () => {
    for (const c of CRITERIA) {
      expect(typeof c.matches).toBe("function");
    }
  });

  it("indexes every catalog entry by id in CRITERIA_BY_ID", () => {
    expect(CRITERIA_BY_ID.size).toBe(CRITERIA.length);
    for (const c of CRITERIA) {
      expect(CRITERIA_BY_ID.get(c.id)).toBe(c);
    }
  });

  it("groups every criterion under exactly one CRITERIA_GROUPS bucket, preserving first-seen order", () => {
    const grouped = CRITERIA_GROUPS.flatMap((g) => g.criteria);
    expect(grouped).toHaveLength(CRITERIA.length);
    expect(new Set(grouped.map((c) => c.id))).toEqual(new Set(CRITERIA.map((c) => c.id)));
    expect(CRITERIA_GROUPS.map((g) => g.group)).toEqual(["Type", "Links", "Source", "Engagement"]);
  });
});

const BASE_FACETS: Facets = {
  hasText: true,
  hasPhoto: false,
  hasVideo: false,
  hasQuote: false,
  hasLink: false,
  linkHosts: [],
  role: null,
  lang: null,
  liked: false,
};
const f = (p: Partial<Facets>): Facets => ({ ...BASE_FACETS, ...p });

const BASE_STATE: FilterState = {
  enabled: true,
  criteria: {},
  onlyMyLanguages: false,
  myLanguages: [],
  linkRules: [],
  presets: [],
  compactHidden: false,
  scopeBindings: {},
};

describe("criterion matchers", () => {
  it("kind:text matches plain text only", () => {
    const m = CRITERIA_BY_ID.get("kind:text")!.matches;
    expect(m(f({ hasText: true }), BASE_STATE)).toBe(true);
    expect(m(f({ hasText: true, hasPhoto: true }), BASE_STATE)).toBe(false);
  });

  it("kind:photo matches posts with a photo", () => {
    const m = CRITERIA_BY_ID.get("kind:photo")!.matches;
    expect(m(f({ hasPhoto: true }), BASE_STATE)).toBe(true);
    expect(m(f({ hasPhoto: false }), BASE_STATE)).toBe(false);
  });

  it("kind:video matches posts with video", () => {
    const m = CRITERIA_BY_ID.get("kind:video")!.matches;
    expect(m(f({ hasVideo: true }), BASE_STATE)).toBe(true);
    expect(m(f({ hasVideo: false }), BASE_STATE)).toBe(false);
  });

  it("kind:quote matches quote posts", () => {
    const m = CRITERIA_BY_ID.get("kind:quote")!.matches;
    expect(m(f({ hasQuote: true }), BASE_STATE)).toBe(true);
    expect(m(f({ hasQuote: false }), BASE_STATE)).toBe(false);
  });

  it("kind:link matches posts with an outbound link", () => {
    const m = CRITERIA_BY_ID.get("kind:link")!.matches;
    expect(m(f({ hasLink: true }), BASE_STATE)).toBe(true);
    expect(m(f({ hasLink: false }), BASE_STATE)).toBe(false);
  });

  it("linkDest:arxiv matches only when a link host classifies to arxiv", () => {
    const m = CRITERIA_BY_ID.get("linkDest:arxiv")!.matches;
    expect(m(f({ hasLink: true, linkHosts: ["arxiv.org"] }), BASE_STATE)).toBe(true);
    expect(m(f({ hasLink: true, linkHosts: ["github.com"] }), BASE_STATE)).toBe(false);
    expect(m(f({ hasLink: false, linkHosts: ["arxiv.org"] }), BASE_STATE)).toBe(false);
  });

  it("linkDest honors user link rules from FilterState", () => {
    const m = CRITERIA_BY_ID.get("linkDest:reddit")!.matches;
    const state = { ...BASE_STATE, linkRules: [{ host: "lemmy.world", dest: "reddit" as const }] };
    expect(m(f({ hasLink: true, linkHosts: ["lemmy.world"] }), state)).toBe(true);
  });

  it("role:repost matches only reposts", () => {
    const m = CRITERIA_BY_ID.get("role:repost")!.matches;
    expect(m(f({ role: "repost" }), BASE_STATE)).toBe(true);
    expect(m(f({ role: null }), BASE_STATE)).toBe(false);
  });

  it("engagement:liked matches only liked posts", () => {
    const m = CRITERIA_BY_ID.get("engagement:liked")!.matches;
    expect(m(f({ liked: true }), BASE_STATE)).toBe(true);
    expect(m(f({ liked: false }), BASE_STATE)).toBe(false);
  });
});
