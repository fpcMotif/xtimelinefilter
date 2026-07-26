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

  describe("video 'only' = originals AND reposts that contain video", () => {
    const only = st({ criteria: { "kind:video": "only" } });

    it("shows an original post that contains video", () => {
      expect(decide(f({ hasVideo: true }), only)).toBe("show");
    });

    it("shows a repost that contains video (role:repost is irrelevant to the kind family)", () => {
      expect(decide(f({ hasVideo: true, role: "repost" }), only)).toBe("show");
    });

    it("hides a plain text repost — a repost with no video is not a video post", () => {
      expect(decide(f({ hasText: true, role: "repost" }), only)).toBe("hide");
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

  describe("unknown criteria stay inert", () => {
    it("does not turn an unknown only criterion into a hide-all family", () => {
      const only = st({ criteria: { "mystery:thing": "only" } });
      expect(decide(f({ hasPhoto: true }), only)).toBe("show");
    });

    it("ignores an unknown only value beside a known value with the same prefix", () => {
      const only = st({ criteria: { "kind:bogus": "only", "kind:photo": "only" } });
      expect(decide(f({ hasPhoto: true }), only)).toBe("show");
      expect(decide(f({ hasVideo: true }), only)).toBe("hide");
    });

    it("ignores an unknown only family beside a known family", () => {
      const only = st({ criteria: { "mystery:thing": "only", "kind:photo": "only" } });
      expect(decide(f({ hasPhoto: true }), only)).toBe("show");
      expect(decide(f({ hasVideo: true }), only)).toBe("hide");
    });

    it("keeps language criteria inert in both only and hide modes", () => {
      expect(decide(f({ lang: "en" }), st({ criteria: { "language:en": "only" } }))).toBe("show");
      expect(decide(f({ lang: "en" }), st({ criteria: { "language:en": "hide" } }))).toBe("show");
    });
  });

  it("honors user link rules when classifying link destinations", () => {
    const gate = st({
      criteria: { "linkDest:reddit": "only" },
      linkRules: [{ host: "lemmy.world", dest: "reddit" }],
    });
    expect(decide(f({ hasLink: true, linkHosts: ["lemmy.world"] }), gate)).toBe("show");
  });

  describe("kind family — every value arm", () => {
    it("video 'only' shows a video post and hides a photo post", () => {
      const only = st({ criteria: { "kind:video": "only" } });
      expect(decide(f({ hasVideo: true }), only)).toBe("show");
      expect(decide(f({ hasPhoto: true }), only)).toBe("hide");
    });

    it("photo 'only' shows a photo post and hides a video post", () => {
      const only = st({ criteria: { "kind:photo": "only" } });
      expect(decide(f({ hasPhoto: true }), only)).toBe("show");
      expect(decide(f({ hasVideo: true }), only)).toBe("hide");
    });

    it("quote 'only' shows a quote post and hides a plain post", () => {
      const only = st({ criteria: { "kind:quote": "only" } });
      expect(decide(f({ hasQuote: true }), only)).toBe("show");
      expect(decide(f({ hasText: true }), only)).toBe("hide");
    });

    it("link 'only' shows a link post and hides a plain post", () => {
      const only = st({ criteria: { "kind:link": "only" } });
      expect(decide(f({ hasLink: true, linkHosts: ["arxiv.org"] }), only)).toBe("show");
      expect(decide(f({ hasText: true }), only)).toBe("hide");
    });

    it("an unknown kind value never matches (hide criterion stays inert)", () => {
      const hide = st({ criteria: { "kind:bogus": "hide" } });
      expect(decide(f({ hasPhoto: true, hasVideo: true }), hide)).toBe("show");
    });
  });

  describe("role + malformed criterion ids", () => {
    it("role:repost 'hide' hides a repost and shows an original", () => {
      const hide = st({ criteria: { "role:repost": "hide" } });
      expect(decide(f({ role: "repost" }), hide)).toBe("hide");
      expect(decide(f({ role: null }), hide)).toBe("show");
    });

    it("a role value other than repost never matches", () => {
      const hide = st({ criteria: { "role:reply": "hide" } });
      expect(decide(f({ role: "repost" }), hide)).toBe("show");
    });

    it("an unknown family never matches (criterion stays inert)", () => {
      const hide = st({ criteria: { "mystery:thing": "hide" } });
      expect(decide(f({ hasPhoto: true }), hide)).toBe("show");
    });

    it("a value-less criterion id never matches (fails closed on match)", () => {
      const hide = st({ criteria: { kind: "hide" } });
      expect(decide(f({ hasPhoto: true }), hide)).toBe("show");
    });
  });

  describe("engagement family — hide what I've already liked", () => {
    it("hide:liked collapses a liked post and shows an un-liked one", () => {
      const hide = st({ criteria: { "engagement:liked": "hide" } });
      expect(decide(f({ liked: true }), hide)).toBe("hide");
      expect(decide(f({ liked: false }), hide)).toBe("show");
    });

    it("only:liked shows a liked post and hides an un-liked one", () => {
      const only = st({ criteria: { "engagement:liked": "only" } });
      expect(decide(f({ liked: true }), only)).toBe("show");
      expect(decide(f({ liked: false }), only)).toBe("hide");
    });

    it("AND across families: only:liked + only:arxiv needs both", () => {
      const only = st({
        criteria: { "engagement:liked": "only", "linkDest:arxiv": "only" },
      });
      expect(decide(f({ liked: true, hasLink: true, linkHosts: ["arxiv.org"] }), only)).toBe(
        "show",
      );
      expect(decide(f({ liked: true }), only)).toBe("hide"); // liked but no arxiv link
    });

    it("an unknown engagement value never matches (criterion stays inert)", () => {
      const hide = st({ criteria: { "engagement:reposted": "hide" } });
      expect(decide(f({ liked: true }), hide)).toBe("show");
    });
  });
});
