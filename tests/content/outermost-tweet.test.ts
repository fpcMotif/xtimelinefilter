import { afterEach, describe, expect, it } from "vitest";

import { outermostTweet } from "@/content/outermost-tweet";

function mount(html: string): void {
  document.body.innerHTML = html;
}
afterEach(() => {
  document.body.innerHTML = "";
});

const tweet = (id: string, inner = "") =>
  `<article id="${id}" data-testid="tweet" role="article">${inner}</article>`;

describe("outermostTweet", () => {
  it("climbs a nested quoted tweet to the outermost article", () => {
    mount(tweet("outer", `<div>${tweet("inner", "quoted")}</div>`));
    const inner = document.getElementById("inner");
    expect(outermostTweet(inner)?.id).toBe("outer");
  });

  it("returns the article itself when nothing tweet-shaped encloses it", () => {
    mount(`<div id="container">${tweet("solo")}</div>`);
    const solo = document.getElementById("solo");
    expect(outermostTweet(solo)?.id).toBe("solo");
  });

  it("returns a detached article (no parent) as itself", () => {
    const detached = document.createElement("article");
    detached.setAttribute("data-testid", "tweet");
    expect(outermostTweet(detached)).toBe(detached);
  });

  it("returns null when given null (the pointer was over no tweet)", () => {
    expect(outermostTweet(null)).toBeNull();
  });
});
