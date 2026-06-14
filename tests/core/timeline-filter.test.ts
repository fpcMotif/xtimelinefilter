import { describe, expect, it } from "vitest";

import type { Facets, FilterState } from "@/core/filter-types";
import { decide } from "@/core/timeline-filter";

const BASE_FACETS: Facets = {
  hasText: true,
  hasPhoto: false,
  hasVideo: false,
  hasQuote: false,
  hasLink: false,
  linkHosts: [],
  role: null,
  lang: null,
};
const f = (p: Partial<Facets>): Facets => ({ ...BASE_FACETS, ...p });

const BASE_STATE: FilterState = {
  enabled: true,
  criteria: {},
  onlyMyLanguages: false,
  myLanguages: [],
  linkRules: [],
};
const st = (p: Partial<FilterState>): FilterState => ({ ...BASE_STATE, ...p });

describe("decide", () => {
  it("hides when a post matches a hide criterion (hide wins)", () => {
    expect(decide(f({ hasVideo: true }), st({ criteria: { "kind:video": "hide" } }))).toBe("hide");
  });

  it("shows when a hide criterion does not match", () => {
    expect(decide(f({ hasPhoto: true }), st({ criteria: { "kind:video": "hide" } }))).toBe("show");
  });

  it("language gate hides a detectable foreign language", () => {
    expect(decide(f({ lang: "en" }), st({ onlyMyLanguages: true, myLanguages: ["ja"] }))).toBe(
      "hide",
    );
  });

  it("language gate passes posts with no detectable language (fail-open)", () => {
    const gate = st({ onlyMyLanguages: true, myLanguages: ["ja"] });
    expect(decide(f({ lang: null }), gate)).toBe("show");
    expect(decide(f({ lang: "und" }), gate)).toBe("show");
  });

  it("language gate normalizes region tags (ja-JP counts as ja)", () => {
    expect(decide(f({ lang: "ja-JP" }), st({ onlyMyLanguages: true, myLanguages: ["ja"] }))).toBe(
      "show",
    );
  });

  describe("only = AND across families, OR within a family", () => {
    const gate = st({
      onlyMyLanguages: true,
      myLanguages: ["ja"],
      criteria: { "linkDest:arxiv": "only", "linkDest:hn": "only" },
    });

    it("shows a Japanese arXiv post (ja AND arxiv)", () => {
      expect(decide(f({ hasLink: true, linkHosts: ["arxiv.org"], lang: "ja" }), gate)).toBe("show");
    });

    it("shows a Japanese Hacker News post (OR within link family)", () => {
      expect(
        decide(f({ hasLink: true, linkHosts: ["news.ycombinator.com"], lang: "ja" }), gate),
      ).toBe("show");
    });

    it("hides a Japanese YouTube post (link family unsatisfied)", () => {
      expect(decide(f({ hasLink: true, linkHosts: ["youtube.com"], lang: "ja" }), gate)).toBe(
        "hide",
      );
    });

    it("hides an English arXiv post (language gate)", () => {
      expect(decide(f({ hasLink: true, linkHosts: ["arxiv.org"], lang: "en" }), gate)).toBe("hide");
    });
  });

  it("text-only only matches a post with no media/card/quote", () => {
    const only = st({ criteria: { "kind:text": "only" } });
    expect(decide(f({ hasText: true }), only)).toBe("show");
    expect(decide(f({ hasText: true, hasPhoto: true }), only)).toBe("hide");
  });

  it("shows when no only/hide criteria are active", () => {
    expect(decide(f({ hasVideo: true }), st({}))).toBe("show");
  });

  it("shows an unclassifiable post (fail-open)", () => {
    expect(decide(f({ hasText: false }), st({}))).toBe("show");
  });

  it("honors user link rules when classifying link destinations", () => {
    const gate = st({
      criteria: { "linkDest:reddit": "only" },
      linkRules: [{ host: "lemmy.world", dest: "reddit" }],
    });
    expect(decide(f({ hasLink: true, linkHosts: ["lemmy.world"] }), gate)).toBe("show");
  });
});
