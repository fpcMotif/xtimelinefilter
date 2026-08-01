import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("resolves the tweet when activedescendant points at a container around it", () => {
    mount(
      `<div aria-activedescendant="wrapper">
        <div id="wrapper"><article id="t1" data-testid="tweet" role="article"></article></div>
      </div>`,
    );
    expect(getFocusedTweet(document)?.id).toBe("t1");
  });

  it("falls through when activedescendant points at a non-tweet node", () => {
    mount(`<div aria-activedescendant="not-tweet"><span id="not-tweet">x</span></div>`);
    expect(getFocusedTweet(document)).toBeNull();
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

  it("falls back to :focus-within when neither prior recipe resolves a tweet", () => {
    // happy-dom does not evaluate the :focus-within pseudo-class against real
    // focus state, so this stubs querySelector to answer the way a browser
    // would once a descendant of the tweet holds focus without the tweet
    // itself — or document.activeElement — being reachable via .closest().
    mount(tweet("t1", "jack"));
    const article = document.getElementById("t1") as HTMLElement;
    const spy = vi
      .spyOn(document, "querySelector")
      .mockImplementation((selector: string) =>
        selector.endsWith(":focus-within") ? article : null,
      );
    try {
      expect(getFocusedTweet(document)?.id).toBe("t1");
    } finally {
      spy.mockRestore();
    }
  });
});
