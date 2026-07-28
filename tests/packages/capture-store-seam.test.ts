import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createCollectionStore } from "@/packages/folders";
import type { PostCapture } from "@/packages/folders/types";
import { capture, type TweetCapture } from "@/packages/tweet-read";

/**
 * The seam between the two packages, which deliberately do NOT import each
 * other: `tweet-read`'s entry point transitively reaches `@/content/selectors`,
 * and `folders` must stay headless, so each declares the capture's shape
 * itself. That is only safe if the shapes stay identical — this file is the one
 * place that proves it, from both directions and at both compile and run time.
 */

/** True only when A and B are assignable to each other. */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

function pin<_Assert extends true>(): void {}

pin<MutuallyAssignable<TweetCapture, PostCapture>>();
pin<MutuallyAssignable<PostCapture, TweetCapture>>();

function article(innerHTML: string): Element {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<article data-testid="tweet">${innerHTML}</article>`;
  return wrap.querySelector("article") as Element;
}

describe("the durable capture is exactly what the store accepts", () => {
  it("assigns in both directions", () => {
    const fromRead: TweetCapture = { statusId: "1", permalink: null, media: [] };
    const asStored: PostCapture = fromRead;
    const backAgain: TweetCapture = asStored;
    expect(backAgain).toBe(fromRead);
  });

  it("files a real capture straight into a Folder, unmodified", async () => {
    const read = capture(
      article(
        `<div data-testid="User-Name"><a href="/jack">Jack</a>` +
          `<a href="/jack/status/9">@jack</a></div>` +
          `<a href="/jack/status/9"><time datetime="2026-07-20T10:00:00.000Z">1h</time></a>` +
          `<div data-testid="tweetText">hello</div>` +
          `<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/a.jpg" /></div>`,
      ),
    );
    const store = await createCollectionStore({
      indexedDB: new IDBFactory(),
      keyRange: IDBKeyRange,
    });
    const { folderId } = await store.createFolder({ name: "Research" });

    // No adapter, no mapping step: the read's output IS the store's input.
    expect(await store.savePost({ folderId, capture: read })).toEqual({
      status: "saved",
      statusId: "9",
    });

    expect(await store.getSavedPost({ statusId: "9" })).toMatchObject({
      statusId: "9",
      permalink: "https://x.com/jack/status/9",
      author: { screenName: "jack" },
      text: "hello",
      media: [{ kind: "photo", url: "https://pbs.twimg.com/media/a.jpg" }],
      postedAt: "2026-07-20T10:00:00.000Z",
    });
  });

  it("refuses a capture the read marked unsavable", async () => {
    const read = capture(article(`<div data-testid="tweetText">no permalink</div>`));
    expect(read.statusId).toBeNull();
    const store = await createCollectionStore({
      indexedDB: new IDBFactory(),
      keyRange: IDBKeyRange,
    });
    const { folderId } = await store.createFolder({ name: "Research" });
    expect(await store.savePost({ folderId, capture: read })).toEqual({ status: "unsavable" });
    expect(await store.countSavedPosts()).toBe(0);
  });
});
