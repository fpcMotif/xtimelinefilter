import { describe, expect, it } from "vitest";

import { extractFacets } from "@/core/tweet-facets";

/**
 * Fixtures model our ASSUMED x.com structure (FacetSelectors). They are confirmed
 * on live x.com by plan task 018 (verify-filter-dom.md) — until then a green test
 * proves the extraction LOGIC, not that the selectors match real posts.
 */
function article(innerHTML: string): Element {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<article data-testid="tweet">${innerHTML}</article>`;
  return wrap.querySelector("article") as Element;
}
const text = (lang: string | null, body = "hello") =>
  `<div data-testid="tweetText"${lang ? ` lang="${lang}"` : ""}>${body}</div>`;

describe("extractFacets", () => {
  it("classifies a photo post", () => {
    const f = extractFacets(article(`${text("en")}<div data-testid="tweetPhoto"></div>`));
    expect(f.hasPhoto).toBe(true);
    expect(f.hasText).toBe(true);
    expect(f.hasVideo).toBe(false);
    expect(f.hasQuote).toBe(false);
    expect(f.hasLink).toBe(false);
  });

  it("treats text + no media/card/quote as text-only (derived)", () => {
    const f = extractFacets(article(text("en", "just words")));
    expect(f).toMatchObject({
      hasText: true,
      hasPhoto: false,
      hasVideo: false,
      hasQuote: false,
      hasLink: false,
    });
  });

  it("classifies a native video post", () => {
    const f = extractFacets(article(`${text("en")}<div data-testid="videoPlayer"></div>`));
    expect(f.hasVideo).toBe(true);
  });

  it("reads a link card's vanity domain, not the t.co href", () => {
    const f = extractFacets(
      article(
        `${text("en", "paper")}<div data-testid="card.wrapper"><a href="https://t.co/abc">arxiv.org</a></div>`,
      ),
    );
    expect(f.hasLink).toBe(true);
    expect(f.linkHosts).toContain("arxiv.org");
    expect(f.linkHosts).not.toContain("t.co");
  });

  it("reads the host from an inline t.co link's visible text", () => {
    const f = extractFacets(
      article(
        `<div data-testid="tweetText" lang="en">see <a href="https://t.co/xyz">github.com/a/b</a></div>`,
      ),
    );
    expect(f.hasLink).toBe(true);
    expect(f.linkHosts).toContain("github.com");
  });

  it("detects a quoted post (nested tweet article)", () => {
    const f = extractFacets(
      article(
        `${text("en", "outer")}<div><article data-testid="tweet">${text("ja", "inner")}</article></div>`,
      ),
    );
    expect(f.hasQuote).toBe(true);
  });

  it("reads the language from the tweetText lang attribute", () => {
    expect(extractFacets(article(text("ja", "こんにちは"))).lang).toBe("ja");
    expect(extractFacets(article(text(null, "no lang"))).lang).toBeNull();
  });

  it("marks a repost via socialContext", () => {
    const f = extractFacets(
      article(`<div data-testid="socialContext">reposted</div>${text("en")}`),
    );
    expect(f.role).toBe("repost");
  });

  it("fails open on a malformed element (never throws)", () => {
    const bad = {
      querySelector() {
        throw new Error("boom");
      },
      querySelectorAll() {
        throw new Error("boom");
      },
    } as unknown as Element;
    let f!: ReturnType<typeof extractFacets>;
    expect(() => {
      f = extractFacets(bad);
    }).not.toThrow();
    expect(f).toMatchObject({ hasText: false, hasLink: false, lang: null, role: null });
    expect(f.linkHosts).toEqual([]);
  });
});
