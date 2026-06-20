import { describe, expect, it } from "vitest";

import { identity } from "@/core/tweet-read";

function article(innerHTML: string): Element {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<article data-testid="tweet">${innerHTML}</article>`;
  return wrap.querySelector("article") as Element;
}

describe("identity", () => {
  it("uses the status id from a permalink", () => {
    expect(identity(article(`<a href="/jack/status/12345"><time>1h</time></a>`))).toBe("12345");
  });

  it("reads any /status/ anchor, not only a strict /<handle>/status/ permalink", () => {
    expect(identity(article(`<a href="/i/status/678">x</a>`))).toBe("678");
  });

  it("falls back to the trimmed visible tweet text when no permalink resolves", () => {
    expect(identity(article(`<div data-testid="tweetText">  hello world  </div>`))).toBe(
      "hello world",
    );
  });

  it("prefers the status id over the text when both are present", () => {
    expect(
      identity(
        article(`<a href="/jack/status/9"><time>1h</time></a><div data-testid="tweetText">t</div>`),
      ),
    ).toBe("9");
  });

  it("is an empty string when neither a permalink nor tweet text is present", () => {
    expect(identity(article(""))).toBe("");
  });
});
