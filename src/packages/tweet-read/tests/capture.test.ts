import { afterEach, describe, expect, it, vi } from "vitest";

import { capture } from "../index";

/**
 * Fixtures model our ASSUMED x.com structure. The media-URL, timestamp and
 * follow-button hooks are AMBER until confirmed on live x.com
 * (verify-capture-dom.md) — a green test proves the capture LOGIC, not that the
 * selectors match real posts.
 */
function article(innerHTML: string): Element {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<article data-testid="tweet">${innerHTML}</article>`;
  return wrap.querySelector("article") as Element;
}

/** The User-Name block: display-name link + the block's own permalink. */
const nameBlock = (handle: string, id: string, display = "Jack") =>
  `<div data-testid="User-Name"><a href="/${handle}">${display}</a>` +
  `<a href="/${handle}/status/${id}">@${handle}</a></div>`;

/** The timestamp permalink — a second, independent status anchor on the host. */
const stamp = (handle: string, id: string, at = "2026-07-20T10:00:00.000Z") =>
  `<a href="/${handle}/status/${id}"><time datetime="${at}">1h</time></a>`;

const text = (body: string) => `<div data-testid="tweetText">${body}</div>`;

const avatar = (handle: string, src?: string) =>
  `<div data-testid="UserAvatar-Container-${handle}">${src ? `<img src="${src}" />` : ""}</div>`;

/** The follow button — the one place an article exposes the numeric user id. */
const followButton = (userId: string) => `<button data-testid="${userId}-follow"></button>`;

/** Puts the page in a signed-in state — which the capture must be blind to. */
const signIn = (handle: string) => {
  document.body.innerHTML = `<a data-testid="AppTabBar_Profile_Link" href="/${handle}"></a>`;
};

afterEach(() => {
  document.body.innerHTML = "";
});

/** A quoted post — itself a tweet article, nested inside the host's subtree. */
const quoted = (handle: string, id: string, inner = "") =>
  `<div><article data-testid="tweet">${nameBlock(handle, id, "Quoted")}${stamp(
    handle,
    id,
    "2020-01-01T00:00:00.000Z",
  )}${avatar(handle)}${inner}</article></div>`;

describe("capture — identity", () => {
  it("reads this article's own status id and composes a canonical permalink", () => {
    const c = capture(article(`${nameBlock("jack", "9")}${stamp("jack", "9")}`));
    expect(c.statusId).toBe("9");
    expect(c.permalink).toBe("https://x.com/jack/status/9");
  });

  it("takes the id from the host's own anchors and rejects a nested quoted post's", () => {
    // Three /status/ anchors: the host's User-Name permalink, the host's timestamp
    // permalink, and the quoted post's. The two host anchors agree; the nested one loses.
    const c = capture(
      article(`${nameBlock("jack", "9")}${stamp("jack", "9")}${quoted("ada", "111")}`),
    );
    expect(c.statusId).toBe("9");
    expect(c.permalink).toBe("https://x.com/jack/status/9");
  });

  it("falls back to the timestamp permalink when the name block carries none", () => {
    const c = capture(
      article(`<div data-testid="User-Name"><a href="/jack">Jack</a></div>${stamp("jack", "9")}`),
    );
    expect(c.statusId).toBe("9");
    expect(c.permalink).toBe("https://x.com/jack/status/9");
  });

  it("composes the permalink rather than copying a media-suffixed href", () => {
    const c = capture(
      article(`<div data-testid="User-Name"><a href="/jack/status/9/photo/1">@jack</a></div>`),
    );
    expect(c.permalink).toBe("https://x.com/jack/status/9");
  });

  it("composes an x.com permalink from a twitter.com href", () => {
    const c = capture(
      article(
        `<div data-testid="User-Name"><a href="https://twitter.com/jack/status/9">@jack</a></div>`,
      ),
    );
    expect(c.statusId).toBe("9");
    expect(c.permalink).toBe("https://x.com/jack/status/9");
  });

  it("rejects a permalink-shaped href on a foreign host", () => {
    // Pathname normalization alone throws the host away — the origin is checked on purpose.
    const c = capture(
      article(
        `<div data-testid="User-Name"><a href="https://evil.example/jack/status/9">@jack</a></div>` +
          `${avatar("jack")}${text("still readable")}`,
      ),
    );
    expect(c.statusId).toBeNull();
    expect(c.permalink).toBeNull();
    expect(c.author).toEqual({ screenName: "jack" });
    expect(c.text).toBe("still readable");
  });

  it("rejects an unparseable href", () => {
    const c = capture(
      article(`<div data-testid="User-Name"><a href="http://[/jack/status/9">@jack</a></div>`),
    );
    expect(c.statusId).toBeNull();
  });

  it("rejects a timestamp anchor carrying no href", () => {
    const c = capture(article(`<a><time datetime="2026-07-20T10:00:00.000Z">1h</time></a>`));
    expect(c.statusId).toBeNull();
    expect(c.postedAt).toBe("2026-07-20T10:00:00.000Z");
  });

  it("ignores an anchor whose path is not a permalink", () => {
    const c = capture(
      article(`<div data-testid="User-Name"><a href="/i/status/notdigits">x</a></div>`),
    );
    expect(c.statusId).toBeNull();
  });

  it("reports no identity when the article carries no status anchor at all", () => {
    // Still returns whatever author, text, media and posted-at it COULD read.
    const c = capture(
      article(
        `${avatar("jack")}${followButton("42")}${text("hello")}` +
          `<time datetime="2026-07-20T10:00:00.000Z">1h</time>` +
          `<div data-testid="tweetPhoto"><img src="a.jpg" /></div>`,
      ),
    );
    expect(c.statusId).toBeNull();
    expect(c.permalink).toBeNull();
    expect(c.author).toEqual({ screenName: "jack", userId: "42" });
    expect(c.text).toBe("hello");
    expect(c.media).toEqual([{ kind: "photo", url: "a.jpg" }]);
    expect(c.postedAt).toBe("2026-07-20T10:00:00.000Z");
  });

  it("reports no identity when only a nested quoted post has a permalink", () => {
    // Never borrows a neighbouring post's id, and never falls back to the loose read.
    const c = capture(article(`${avatar("jack")}${text("hi")}${quoted("ada", "111")}`));
    expect(c.statusId).toBeNull();
    expect(c.permalink).toBeNull();
    expect(c.text).toBe("hi");
  });
});

describe("capture — post shapes", () => {
  it("captures the host post of a quote tweet, not the post it quotes", () => {
    // The quoted post's permalink comes FIRST in document order.
    const c = capture(
      article(
        `${quoted("ada", "111", text("quoted words"))}${nameBlock("jack", "9")}${stamp(
          "jack",
          "9",
        )}${avatar("jack")}${text("host words")}`,
      ),
    );
    expect(c.statusId).toBe("9");
    expect(c.permalink).toBe("https://x.com/jack/status/9");
    expect(c.author).toEqual({ screenName: "jack" });
    expect(c.text).toBe("host words");
  });

  it("captures the underlying post of a repost, so three reposts are one id", () => {
    const repost = (by: string) =>
      capture(
        article(
          `<div data-testid="socialContext">${by} reposted</div>` +
            `${nameBlock("ada", "111", "Ada")}${stamp("ada", "111")}${avatar("ada")}`,
        ),
      );
    const ids = ["bob", "cleo", "dee"].map((by) => repost(by).statusId);
    expect(new Set(ids)).toEqual(new Set(["111"]));
    expect(repost("bob").author).toEqual({ screenName: "ada" });
    expect(repost("bob").permalink).toBe("https://x.com/ada/status/111");
  });

  it("captures a promoted post like any other — the ad skip is not inherited", () => {
    // The promoted WRAPPER carries its own /status/ anchor, outside the article.
    // It must never win the id: the read only ever looks inside this article.
    const wrap = document.createElement("div");
    wrap.innerHTML =
      `<div data-testid="placementTracking">` +
      `<a href="/adtracker/status/999">sponsored</a>` +
      `<article data-testid="tweet">` +
      `<div data-testid="socialContext">Promoted</div>` +
      `${nameBlock("brand", "77")}${stamp("brand", "77")}${avatar("brand")}${text("buy this")}` +
      `</article></div>`;
    const c = capture(wrap.querySelector("article") as Element);
    expect(c.statusId).toBe("77");
    expect(c.permalink).toBe("https://x.com/brand/status/77");
    expect(c.author).toEqual({ screenName: "brand" });
    expect(c.text).toBe("buy this");
  });
});

describe("capture — payload", () => {
  it("expands emoji alt text and collapses whitespace", () => {
    const c = capture(
      article(`<div data-testid="tweetText">  hello   <img alt="🎉" />  world  </div>`),
    );
    expect(c.text).toBe("hello 🎉 world");
  });

  it("returns no text when the host has none and a quoted post does", () => {
    const c = capture(
      article(`${nameBlock("jack", "9")}${quoted("ada", "111", text("quoted only"))}`),
    );
    expect(c.text).toBeUndefined();
  });

  it("returns no text when the host's text node is empty", () => {
    const c = capture(article(`${nameBlock("jack", "9")}${text("   ")}`));
    expect(c.text).toBeUndefined();
  });

  it("reads the host's own timestamp as an ISO instant", () => {
    const c = capture(article(`${nameBlock("jack", "9")}${stamp("jack", "9")}`));
    expect(c.postedAt).toBe("2026-07-20T10:00:00.000Z");
  });

  it("ignores a quoted post's timestamp", () => {
    const c = capture(article(`${nameBlock("jack", "9")}${quoted("ada", "111")}`));
    expect(c.postedAt).toBeUndefined();
  });

  it("omits posted-at when the timestamp is unparseable", () => {
    const c = capture(article(`${nameBlock("jack", "9")}<time datetime="not-a-date">1h</time>`));
    expect(c.postedAt).toBeUndefined();
  });

  it("omits posted-at when the timestamp carries no datetime", () => {
    const c = capture(article(`${nameBlock("jack", "9")}<time>1h</time>`));
    expect(c.postedAt).toBeUndefined();
  });

  it("reads the numeric user id from the follow button when X renders one", () => {
    const c = capture(article(`${nameBlock("jack", "9")}${followButton("12")}`));
    expect(c.author).toEqual({ screenName: "jack", userId: "12" });
  });

  it("reads the numeric user id from an already-following button", () => {
    const c = capture(
      article(`${nameBlock("jack", "9")}<button data-testid="12-unfollow"></button>`),
    );
    expect(c.author).toEqual({ screenName: "jack", userId: "12" });
  });

  it("omits the user id when the article renders no follow button", () => {
    const c = capture(
      article(
        `${nameBlock("jack", "9")}${avatar("jack", "https://pbs.twimg.com/profile_images/17/a.jpg")}`,
      ),
    );
    // The avatar CDN path is NOT a user id (its first segment is the image's own
    // id) — research 03 §4: rest_id is not a DOM attribute.
    expect(c.author).toEqual({ screenName: "jack" });
  });

  it("ignores a follow-button testid whose prefix is not a numeric id", () => {
    const c = capture(
      article(`${nameBlock("jack", "9")}<button data-testid="UserCell-follow"></button>`),
    );
    expect(c.author).toEqual({ screenName: "jack" });
  });

  it("does not borrow a quoted post's follow button for the host's user id", () => {
    const c = capture(
      article(
        `${nameBlock("jack", "9")}<div><article data-testid="tweet">${followButton(
          "999",
        )}</article></div>`,
      ),
    );
    expect(c.author).toEqual({ screenName: "jack" });
  });

  it("omits the author entirely when neither a permalink nor an avatar names one", () => {
    const c = capture(article(text("orphan")));
    expect(c.author).toBeUndefined();
  });
});

describe("capture — media", () => {
  it("records a photo with its image src", () => {
    const c = capture(
      article(
        `${nameBlock("jack", "9")}<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/a.jpg" /></div>`,
      ),
    );
    expect(c.media).toEqual([{ kind: "photo", url: "https://pbs.twimg.com/media/a.jpg" }]);
  });

  it("records a photo with no URL when the node exposes none", () => {
    const c = capture(article(`${nameBlock("jack", "9")}<div data-testid="tweetPhoto"></div>`));
    expect(c.media).toEqual([{ kind: "photo" }]);
  });

  it("records a video with its poster", () => {
    const c = capture(
      article(
        `${nameBlock("jack", "9")}<div data-testid="videoPlayer"><video poster="https://pbs.twimg.com/p.jpg"></video></div>`,
      ),
    );
    expect(c.media).toEqual([{ kind: "video", url: "https://pbs.twimg.com/p.jpg" }]);
  });

  it("falls back to a video's thumbnail image", () => {
    const c = capture(
      article(
        `${nameBlock("jack", "9")}<div data-testid="videoComponent"><img src="https://pbs.twimg.com/t.jpg" /></div>`,
      ),
    );
    expect(c.media).toEqual([{ kind: "video", url: "https://pbs.twimg.com/t.jpg" }]);
  });

  it("records a video with no URL when it exposes neither poster nor thumbnail", () => {
    const c = capture(article(`${nameBlock("jack", "9")}<div data-testid="videoPlayer"></div>`));
    expect(c.media).toEqual([{ kind: "video" }]);
  });

  it("counts a hydrated video's poster photo once, as the video", () => {
    // X renders a video's still as a tweetPhoto inside the player once it hydrates.
    const c = capture(
      article(
        `${nameBlock("jack", "9")}<div data-testid="videoPlayer">` +
          `<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/still.jpg" /></div></div>`,
      ),
    );
    expect(c.media).toEqual([{ kind: "video", url: "https://pbs.twimg.com/still.jpg" }]);
  });

  it("records several photos in document order", () => {
    const c = capture(
      article(
        `${nameBlock("jack", "9")}<div data-testid="tweetPhoto"><img src="a.jpg" /></div>` +
          `<div data-testid="tweetPhoto"><img src="b.jpg" /></div>`,
      ),
    );
    expect(c.media).toEqual([
      { kind: "photo", url: "a.jpg" },
      { kind: "photo", url: "b.jpg" },
    ]);
  });

  it("does not record a quoted post's media", () => {
    const c = capture(
      article(
        `${nameBlock("jack", "9")}${quoted(
          "ada",
          "111",
          `<div data-testid="tweetPhoto"><img src="quoted.jpg" /></div>`,
        )}`,
      ),
    );
    expect(c.media).toEqual([]);
  });

  it("downloads no bytes and synthesizes no URL", () => {
    const fetchSpy = vi.fn();
    const imageSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("Image", imageSpy);
    vi.stubGlobal("XMLHttpRequest", imageSpy);

    const c = capture(
      article(
        `${nameBlock("jack", "9")}<div data-testid="tweetPhoto"></div>` +
          `<div data-testid="videoPlayer"><video poster="p.jpg"></video></div>`,
      ),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(imageSpy).not.toHaveBeenCalled();
    // The photo node exposes no URL, so none is invented for it.
    expect(c.media[0]).not.toHaveProperty("url");
    expect(c.media[1]).toEqual({ kind: "video", url: "p.jpg" });
    vi.unstubAllGlobals();
  });
});

describe("capture — fail-open", () => {
  it("never throws on a malformed element", () => {
    const bad = {
      querySelector() {
        throw new Error("boom");
      },
      querySelectorAll() {
        throw new Error("boom");
      },
    } as unknown as Element;
    expect(() => capture(bad)).not.toThrow();
    expect(capture(bad)).toEqual({ statusId: null, permalink: null, media: [] });
  });

  it("degrades to a partial capture on an element that is not a tweet article", () => {
    const div = document.createElement("div");
    div.innerHTML = `${nameBlock("jack", "9")}${text("loose")}`;
    const c = capture(div);
    expect(c.statusId).toBeNull();
    expect(c.permalink).toBeNull();
    expect(c.media).toEqual([]);
  });

  it("degrades to a partial capture on an empty article", () => {
    expect(capture(article(""))).toEqual({ statusId: null, permalink: null, media: [] });
  });
});

describe("capture — account freedom", () => {
  const populated = () =>
    article(
      `${nameBlock("jack", "9")}${stamp("jack", "9")}${avatar("jack")}${followButton("12")}` +
        `${text("hello")}<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/a.jpg" /></div>`,
    );

  it("carries exactly the capture's own keys and no account field", () => {
    // The allow-list is what makes account-freedom checkable: a later ownerUserId,
    // xAccountId, accountId, twid or signed-in handle cannot be added without failing here.
    const c = capture(populated());
    expect(Object.keys(c)).toEqual([
      "statusId",
      "permalink",
      "author",
      "text",
      "media",
      "postedAt",
    ]);
    expect(Object.keys(c.author as object)).toEqual(["screenName", "userId"]);
  });

  it("keeps every other fixture's keys a subset of that list", () => {
    const allowed = new Set(["statusId", "permalink", "author", "text", "media", "postedAt"]);
    const fixtures = [
      article(""),
      article(text("orphan")),
      article(`${nameBlock("jack", "9")}${quoted("ada", "111")}`),
      populated(),
    ];
    for (const el of fixtures) {
      const c = capture(el);
      expect(Object.keys(c).every((k) => allowed.has(k))).toBe(true);
      if (c.author) {
        expect(Object.keys(c.author).every((k) => k === "screenName" || k === "userId")).toBe(true);
      }
    }
  });

  it("takes exactly one parameter — no account, Owner, session or options bag", () => {
    expect(capture.length).toBe(1);
  });

  it("returns a deep-equal capture whichever account the page is signed in as", () => {
    signIn("alice");
    const asAlice = capture(populated());
    signIn("bob");
    const asBob = capture(populated());
    document.body.innerHTML = "";
    expect(asAlice).toEqual(asBob);
  });
});
