import { afterEach, describe, expect, it } from "vitest";

import { getFocusedTweet } from "@/content/get-focused-tweet";

function mount(html: string): void {
  document.body.innerHTML = html;
}
afterEach(() => {
  document.body.innerHTML = "";
});

const tweet = (id: string, handle: string) => `
  <article id="${id}" data-testid="tweet" role="article" tabindex="0">
    <div data-testid="User-Name"><div><a href="/${handle}/status/1"><time>1h</time></a></div></div>
  </article>`;

describe("getFocusedTweet", () => {
  it("resolves the tweet via aria-activedescendant", () => {
    mount(`<div aria-activedescendant="t1">${tweet("t1", "jack")}${tweet("t2", "alice")}</div>`);
    expect(getFocusedTweet(document)?.id).toBe("t1");
  });

  it("resolves the tweet when activedescendant points at an inner node", () => {
    mount(
      `<div aria-activedescendant="inner">
        <article id="t1" data-testid="tweet" role="article"><span id="inner">x</span></article>
      </div>`,
    );
    expect(getFocusedTweet(document)?.id).toBe("t1");
  });

  it("falls back to document.activeElement's closest tweet", () => {
    mount(tweet("t1", "jack"));
    (document.getElementById("t1") as HTMLElement).focus();
    expect(getFocusedTweet(document)?.id).toBe("t1");
  });

  it("returns null when no tweet is focused", () => {
    mount(`<div>nothing focused</div>`);
    expect(getFocusedTweet(document)).toBeNull();
  });
});
