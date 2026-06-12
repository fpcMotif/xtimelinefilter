import { afterEach, describe, expect, it } from "vitest";

import { extractAuthor, getTweetType } from "@/core/tweet-extractor";

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html.trim();
  document.body.appendChild(host);
  return host;
}
const tweetEl = (html: string) => mount(html).querySelector("article") as Element;

afterEach(() => {
  document.body.innerHTML = "";
});

const NORMAL = `
<article data-testid="tweet" role="article">
  <div data-testid="User-Name">
    <div><a href="/jack"><span>Jack 🚀</span></a><svg data-testid="icon-verified"></svg></div>
    <div><a href="/jack"><span>@jack</span></a>·<a href="/jack/status/123"><time datetime="2024-01-01">1h</time></a></div>
  </div>
  <div data-testid="UserAvatar-Container-jack"><img src="https://pbs.twimg.com/profile_images/111/abc_normal.jpg"></div>
  <div data-testid="tweetText">hello world</div>
</article>`;

const RETWEET = `
<article data-testid="tweet" role="article">
  <div data-testid="socialContext"><a href="/bob"><span>Bob reposted</span></a></div>
  <div data-testid="User-Name">
    <div><a href="/jack"><span>Jack</span></a></div>
    <div><a href="/jack"><span>@jack</span></a>·<a href="/jack/status/123"><time>1h</time></a></div>
  </div>
  <div data-testid="UserAvatar-Container-jack"><img src="https://pbs.twimg.com/profile_images/111/abc_normal.jpg"></div>
</article>`;

const PROMOTED = `
<div data-testid="placementTracking">
  <article data-testid="tweet" role="article">
    <div data-testid="User-Name">
      <div><a href="/acme"><span>Acme</span></a></div>
      <div><a href="/acme"><span>@acme</span></a>·<a href="/acme/status/999"><time>1h</time></a></div>
    </div>
    <div data-testid="socialContext"><span>Promoted</span></div>
  </article>
</div>`;

const PROMOTED_SOCIAL_ONLY = `
<article data-testid="tweet" role="article">
  <div data-testid="socialContext"><span>Promoted</span></div>
  <div data-testid="User-Name">
    <div><a href="/ad"><span>Ad</span></a></div>
    <div><a href="/ad/status/999"><time>1h</time></a></div>
  </div>
</article>`;

const QUOTE = `
<article data-testid="tweet" role="article">
  <div data-testid="User-Name">
    <div><a href="/jack"><span>Jack</span></a></div>
    <div><a href="/jack"><span>@jack</span></a>·<a href="/jack/status/500"><time>1h</time></a></div>
  </div>
  <div role="link">
    <div data-testid="User-Name">
      <div><a href="/alice"><span>Alice</span></a></div>
      <div><a href="/alice"><span>@alice</span></a>·<a href="/alice/status/400"><time>2h</time></a></div>
    </div>
  </div>
</article>`;

const AVATAR_ONLY = `
<article data-testid="tweet" role="article">
  <div data-testid="UserAvatar-Container-zoe"><img src="https://pbs.twimg.com/profile_images/222/x_normal.jpg"></div>
</article>`;

const TIME_LINK_ONLY = `
<article data-testid="tweet" role="article">
  <a href="/mira/status/888"><time>1h</time></a>
  <div data-testid="UserAvatar-Container-mira"></div>
</article>`;

const EMOJI_NAME = `
<article data-testid="tweet" role="article">
  <div data-testid="User-Name">
    <div><a href="/nina"><span>Nina <img alt="✨"></span></a></div>
    <div><a href="/nina/status/321"><time>1h</time></a></div>
  </div>
</article>`;

describe("extractAuthor", () => {
  it("extracts handle, tweetId, display name (emoji via alt-free text), avatar from a normal tweet", () => {
    const a = extractAuthor(tweetEl(NORMAL));
    expect(a).toMatchObject({
      screenName: "jack",
      tweetId: "123",
      displayName: "Jack 🚀",
      avatarUrl: "https://pbs.twimg.com/profile_images/111/abc_normal.jpg",
    });
    expect(a?.userId).toBeUndefined();
  });

  it("returns the ORIGINAL author for a retweet (not the reposter)", () => {
    expect(extractAuthor(tweetEl(RETWEET))).toMatchObject({ screenName: "jack", tweetId: "123" });
  });

  it("skips promoted tweets (returns null)", () => {
    expect(extractAuthor(tweetEl(PROMOTED))).toBeNull();
    expect(extractAuthor(tweetEl(PROMOTED_SOCIAL_ONLY))).toBeNull();
  });

  it("extracts the OUTER author of a quote tweet, never the quoted account", () => {
    expect(extractAuthor(tweetEl(QUOTE))).toMatchObject({ screenName: "jack", tweetId: "500" });
  });

  it("falls back to the avatar-container handle when the name block is absent", () => {
    const a = extractAuthor(tweetEl(AVATAR_ONLY));
    expect(a?.screenName).toBe("zoe");
    expect(a?.tweetId).toBeUndefined();
  });

  it("falls back to a time permalink when the name block status link is absent", () => {
    expect(extractAuthor(tweetEl(TIME_LINK_ONLY))).toMatchObject({
      screenName: "mira",
      tweetId: "888",
    });
  });

  it("expands emoji image alt text in display names", () => {
    expect(extractAuthor(tweetEl(EMOJI_NAME))?.displayName).toBe("Nina ✨");
  });

  it("ignores comment nodes while reading display names", () => {
    const a = extractAuthor(
      tweetEl(`
        <article data-testid="tweet">
          <div data-testid="User-Name">
            <a href="/comment"><span>Com<!-- verified badge placeholder -->ment</span></a>
            <a href="/comment/status/7"><time>1h</time></a>
          </div>
        </article>
      `),
    );
    expect(a?.displayName).toBe("Comment");
  });

  it("returns null when neither permalink nor avatar provides a handle", () => {
    expect(extractAuthor(tweetEl('<article data-testid="tweet"></article>'))).toBeNull();
  });

  it("returns undefined display names when visible text is empty", () => {
    const a = extractAuthor(
      tweetEl(`
        <article data-testid="tweet">
          <div data-testid="User-Name"><a href="/blank"></a></div>
          <a href="/blank/status/5"><time>1h</time></a>
        </article>
      `),
    );
    expect(a?.displayName).toBeUndefined();
  });

  it("ignores malformed permalink hrefs and malformed avatar test ids", () => {
    const a = extractAuthor(
      tweetEl(`
        <article data-testid="tweet">
          <div data-testid="User-Name"><a href="http://[bad]/status/1"><span>Bad</span></a></div>
          <div data-testid="UserAvatar-Container-"></div>
        </article>
      `),
    );
    expect(a).toBeNull();
  });

  it("handles missing hrefs while reading display names", () => {
    const a = extractAuthor(
      tweetEl(`
        <article data-testid="tweet">
          <div data-testid="User-Name"><a><span>Fallback Block</span></a></div>
          <a href="/block/status/6"><time>1h</time></a>
        </article>
      `),
    );
    expect(a?.displayName).toBe("Fallback Block");
  });

  it("returns null for a non-tweet element", () => {
    const div = mount('<div data-testid="UserCell">who to follow</div>')
      .firstElementChild as Element;
    expect(extractAuthor(div)).toBeNull();
  });
});

describe("getTweetType", () => {
  it("classifies a normal tweet, a retweet, and a promoted tweet", () => {
    expect(getTweetType(tweetEl(NORMAL))).toBe("tweet");
    expect(getTweetType(tweetEl(RETWEET))).toBe("retweet");
    expect(
      getTweetType(
        tweetEl(`
          <article data-testid="tweet">
            <div data-testid="socialContext"></div>
          </article>
        `),
      ),
    ).toBe("retweet");
    expect(getTweetType(tweetEl(PROMOTED))).toBe("promoted");
  });
});
