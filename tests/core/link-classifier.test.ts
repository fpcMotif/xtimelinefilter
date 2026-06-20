import { describe, expect, it } from "vitest";

import { classifyHost } from "@/core/link-classifier";

describe("classifyHost", () => {
  it("maps each built-in host to its destination", () => {
    expect(classifyHost("https://arxiv.org/abs/2401.00001")).toBe("arxiv");
    expect(classifyHost("https://news.ycombinator.com/item?id=1")).toBe("hn");
    expect(classifyHost("https://www.reddit.com/r/x")).toBe("reddit");
    expect(classifyHost("https://www.youtube.com/watch?v=x")).toBe("youtube");
    expect(classifyHost("https://youtu.be/abc")).toBe("youtube");
    expect(classifyHost("https://github.com/a/b")).toBe("github");
  });

  it("falls back to article for unknown external hosts", () => {
    expect(classifyHost("https://example.com/some-post")).toBe("article");
    expect(classifyHost("https://blog.substack.com/p/x")).toBe("article");
  });

  it("matches subdomains", () => {
    expect(classifyHost("https://old.reddit.com/r/x")).toBe("reddit");
    expect(classifyHost("https://m.youtube.com/watch?v=x")).toBe("youtube");
  });

  it("does not throw on malformed input and returns article", () => {
    expect(classifyHost("not-a-url")).toBe("article");
    expect(classifyHost("")).toBe("article");
  });

  it("lets a user rule win over a default", () => {
    const rules = [{ host: "youtube.com", dest: "article" as const }];
    expect(classifyHost("https://youtube.com/watch?v=x", rules)).toBe("article");
  });

  it("applies a user rule for an otherwise-unknown host", () => {
    const rules = [{ host: "lemmy.world", dest: "reddit" as const }];
    expect(classifyHost("https://lemmy.world/post/1", rules)).toBe("reddit");
  });

  it("skips a user rule with an empty host and falls through to defaults", () => {
    const rules = [{ host: "", dest: "article" as const }];
    // The empty-host rule is skipped; the built-in arxiv default still wins.
    expect(classifyHost("https://arxiv.org/abs/1", rules)).toBe("arxiv");
  });

  it("accepts a bare host (not a full URL) like tweet-read's facets store", () => {
    expect(classifyHost("reddit.com")).toBe("reddit");
  });
});
