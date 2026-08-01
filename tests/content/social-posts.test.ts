import { afterEach, describe, expect, it } from "vitest";

import { createSocialPostAdapter, socialPlatformForHost } from "@/content/social-posts";
import { createTimelineCursor } from "@/content/social-posts";

function mount(markup: string): void {
  document.body.innerHTML = markup;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("social platform resolution", () => {
  it("recognizes the current Threads and Instagram hosts only", () => {
    expect(socialPlatformForHost("www.threads.com")).toBe("threads");
    expect(socialPlatformForHost("threads.net")).toBe("threads");
    expect(socialPlatformForHost("www.instagram.com")).toBe("instagram");
    expect(socialPlatformForHost("instagram.com")).toBe("instagram");
    expect(socialPlatformForHost("x.com")).toBeNull();
  });
});

describe("social post adapters", () => {
  it("reads a Threads post from its permalink without X selectors", () => {
    mount(`
      <main>
        <div class="post">
          <a href="/@alice/post/AbC-123"><time datetime="2026-08-01T10:00:00Z">1h</time></a>
          <p>Hello from Threads</p>
          <img src="https://cdn.example/photo.jpg">
        </div>
      </main>
    `);
    const adapter = createSocialPostAdapter("threads");
    const post = adapter.posts(document)[0];
    expect(post?.key).toBe("threads:AbC-123");
    expect(adapter.capture(post!.root)).toMatchObject({
      statusId: "threads:AbC-123",
      permalink: "https://www.threads.com/@alice/post/AbC-123",
      author: { screenName: "alice" },
      text: "Hello from Threads",
      media: [{ kind: "photo", url: "https://cdn.example/photo.jpg" }],
      postedAt: "2026-08-01T10:00:00.000Z",
    });
  });

  it("reads Instagram post and reel links as distinct durable identities", () => {
    mount(`
      <main>
        <div class="post"><a href="/p/CODE_1/"><time datetime="2026-08-01T10:00:00Z">1h</time></a><a href="/p/CODE_1/liked_by/">Likes</a><p>Photo</p></div>
        <div class="post"><a href="/reel/REEL_2/"><time datetime="2026-08-01T11:00:00Z">now</time></a><p>Video</p><video poster="https://cdn.example/poster.jpg"></video></div>
      </main>
    `);
    const adapter = createSocialPostAdapter("instagram");
    expect(adapter.posts(document).map((post) => post.key)).toEqual([
      "instagram:CODE_1",
      "instagram:REEL_2",
    ]);
    expect(adapter.capture(adapter.posts(document)[1]!.root)).toMatchObject({
      statusId: "instagram:REEL_2",
      media: [{ kind: "video", url: "https://cdn.example/poster.jpg" }],
    });
  });
});

describe("Timeline Cursor", () => {
  it("moves through visible posts without wrapping and lets pointer focus win", () => {
    mount(`
      <main>
        <div class="post" id="one"><a href="/@a/post/one"><time>1h</time></a><p>First post</p></div>
        <div class="post" id="two"><a href="/@b/post/two"><time>2h</time></a><p>Second post</p></div>
        <div class="post" id="three" hidden><a href="/@c/post/three"><time>3h</time></a><p>Hidden post</p></div>
      </main>
    `);
    const cursor = createTimelineCursor(createSocialPostAdapter("threads"), document);
    expect(cursor.move("next")?.id).toBe("one");
    expect(cursor.move("next")?.id).toBe("two");
    expect(cursor.move("next")?.id).toBe("two");
    expect(cursor.move("previous")?.id).toBe("one");
    expect(cursor.observePointer(document.querySelector("#two p"))?.id).toBe("two");
    expect(cursor.current()?.id).toBe("two");
  });

  it("rebinds the cursor marker to a recycled post with the same identity", () => {
    mount(`
      <main>
        <div class="post" id="one"><a href="/@a/post/one"><time>1h</time></a><p>First post</p></div>
        <div class="post" id="two"><a href="/@b/post/two"><time>2h</time></a><p>Second post</p></div>
      </main>
    `);
    const cursor = createTimelineCursor(createSocialPostAdapter("threads"), document);
    cursor.move("next");
    const oldRoot = document.querySelector("#one")!;
    oldRoot.replaceWith(
      Object.assign(document.createElement("div"), {
        className: "post",
        id: "recycled",
        innerHTML: '<a href="/@a/post/one"><time>1h</time></a><p>First post refreshed</p>',
      }),
    );
    const refreshed = cursor.current();
    expect(refreshed?.id).toBe("recycled");
    expect(refreshed?.getAttribute("data-lasso-cursor")).toBe("true");
  });
});
