import { describe, expect, it } from "vitest";

import { facets } from "@/core/tweet-read";

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

describe("facets", () => {
  it("classifies a photo post", () => {
    const f = facets(article(`${text("en")}<div data-testid="tweetPhoto"></div>`));
    expect(f.hasPhoto).toBe(true);
    expect(f.hasText).toBe(true);
    expect(f.hasVideo).toBe(false);
    expect(f.hasQuote).toBe(false);
    expect(f.hasLink).toBe(false);
  });

  it("treats text + no media/card/quote as text-only (derived)", () => {
    const f = facets(article(text("en", "just words")));
    expect(f).toMatchObject({
      hasText: true,
      hasPhoto: false,
      hasVideo: false,
      hasQuote: false,
      hasLink: false,
    });
  });

  it("classifies a native video post", () => {
    const f = facets(article(`${text("en")}<div data-testid="videoPlayer"></div>`));
    expect(f.hasVideo).toBe(true);
  });

  it("classifies a native video post via the videoComponent arm", () => {
    const f = facets(article(`${text("en")}<div data-testid="videoComponent"></div>`));
    expect(f.hasVideo).toBe(true);
  });

  it("detects video inside a repost — a reposted video is still hasVideo + role:repost", () => {
    // X renders the reposted (original) tweet's media inline in the same article,
    // with a socialContext "… reposted" label. So a repost-of-a-video reads as a
    // video post AND a repost — the two facets are independent, never exclusive.
    const f = facets(
      article(
        `<div data-testid="socialContext">reposted</div>${text("en")}<div data-testid="videoComponent"></div>`,
      ),
    );
    expect(f.hasVideo).toBe(true);
    expect(f.role).toBe("repost");
  });

  it("reads a link card's vanity domain, not the t.co href", () => {
    const f = facets(
      article(
        `${text("en", "paper")}<div data-testid="card.wrapper"><a href="https://t.co/abc">arxiv.org</a></div>`,
      ),
    );
    expect(f.hasLink).toBe(true);
    expect(f.linkHosts).toContain("arxiv.org");
    expect(f.linkHosts).not.toContain("t.co");
  });

  it("reads the host from an inline t.co link's visible text", () => {
    const f = facets(
      article(
        `<div data-testid="tweetText" lang="en">see <a href="https://t.co/xyz">github.com/a/b</a></div>`,
      ),
    );
    expect(f.hasLink).toBe(true);
    expect(f.linkHosts).toContain("github.com");
  });

  it("detects a quoted post (nested tweet article)", () => {
    const f = facets(
      article(
        `${text("en", "outer")}<div><article data-testid="tweet">${text("ja", "inner")}</article></div>`,
      ),
    );
    expect(f.hasQuote).toBe(true);
  });

  it("reads the language from the tweetText lang attribute", () => {
    expect(facets(article(text("ja", "こんにちは"))).lang).toBe("ja");
    expect(facets(article(text(null, "no lang"))).lang).toBeNull();
  });

  it("marks a repost via socialContext", () => {
    const f = facets(article(`<div data-testid="socialContext">reposted</div>${text("en")}`));
    expect(f.role).toBe("repost");
  });

  it("reads a vanity domain from a card span when there is no t.co anchor", () => {
    const f = facets(
      article(
        `${text("en", "paper")}<div data-testid="card.wrapper"><span>news.ycombinator.com</span></div>`,
      ),
    );
    expect(f.hasLink).toBe(true);
    expect(f.linkHosts).toContain("news.ycombinator.com");
  });

  it("reads the host directly from an external (non-t.co) outbound href", () => {
    const f = facets(
      article(
        `<div data-testid="tweetText" lang="en">see <a href="https://arxiv.org/abs/2401.00001">arxiv</a></div>`,
      ),
    );
    expect(f.hasLink).toBe(true);
    expect(f.linkHosts).toContain("arxiv.org");
  });

  it("skips card children whose text is not a host and an empty card span", () => {
    const f = facets(
      article(
        `${text("en", "paper")}<div data-testid="card.wrapper"><span></span><div>Read more</div></div>`,
      ),
    );
    expect(f.hasLink).toBe(true); // a card is always a link
    expect(f.linkHosts).toEqual([]);
  });

  it("ignores a malformed outbound href and never throws (fail-open per link)", () => {
    const f = facets(
      article(`<div data-testid="tweetText" lang="en">see <a href="http://[">broken</a></div>`),
    );
    expect(f.hasLink).toBe(false);
    expect(f.linkHosts).toEqual([]);
  });

  it("classifies a link card as a link even when it carries no parseable host", () => {
    const f = facets(article(`${text("en")}<div data-testid="card.wrapper"></div>`));
    expect(f.hasLink).toBe(true);
    expect(f.linkHosts).toEqual([]);
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
    let f!: ReturnType<typeof facets>;
    expect(() => {
      f = facets(bad);
    }).not.toThrow();
    expect(f).toMatchObject({ hasText: false, hasLink: false, lang: null, role: null });
    expect(f.linkHosts).toEqual([]);
  });
});
