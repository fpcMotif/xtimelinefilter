import { afterEach, describe, expect, it, vi } from "vitest";

import { createTweetScanner } from "@/content/tweet-scanner";
import type { TweetAuthor } from "@/core/selection-store";

const tweetHtml = (handle: string, id: string) => `
<article data-testid="tweet" role="article">
  <div data-testid="User-Name">
    <div><a href="/${handle}"><span>${handle}</span></a></div>
    <div><a href="/${handle}"><span>@${handle}</span></a>·<a href="/${handle}/status/${id}"><time>1h</time></a></div>
  </div>
</article>`;

afterEach(() => {
  document.body.innerHTML = "";
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createTweetScanner", () => {
  it("processes tweets already present on start()", () => {
    const root = document.createElement("div");
    root.innerHTML = tweetHtml("jack", "1") + tweetHtml("alice", "2");
    document.body.appendChild(root);

    const seen: TweetAuthor[] = [];
    createTweetScanner(root, (a) => seen.push(a)).start();
    expect(seen.map((a) => a.screenName)).toEqual(["jack", "alice"]);
  });

  it("reports tweets added later, once each", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onTweet = vi.fn();
    const scanner = createTweetScanner(root, onTweet);
    scanner.start();

    const cell = document.createElement("div");
    cell.innerHTML = tweetHtml("bob", "3");
    root.appendChild(cell);
    await tick();

    expect(onTweet).toHaveBeenCalledTimes(1);
    expect(onTweet.mock.calls[0]?.[0]).toMatchObject({ screenName: "bob", tweetId: "3" });
    scanner.stop();
  });

  it("observes document.body and handles direct tweet nodes plus non-elements", async () => {
    const onTweet = vi.fn();
    const scanner = createTweetScanner(document, onTweet);
    scanner.start();

    document.body.appendChild(document.createTextNode("noise"));
    const cell = document.createElement("div");
    cell.innerHTML = tweetHtml("direct", "4");
    const article = cell.firstElementChild as Element;
    document.body.appendChild(article);
    await tick();

    expect(onTweet).toHaveBeenCalledWith(
      expect.objectContaining({ screenName: "direct", tweetId: "4" }),
      article,
    );
    scanner.stop();
  });

  it("dedupes invalid tweet nodes even when extraction returns null", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onTweet = vi.fn();
    const scanner = createTweetScanner(root, onTweet);
    scanner.start();

    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    root.appendChild(article);
    await tick();
    scanner.scanExisting();

    expect(onTweet).not.toHaveBeenCalled();
    scanner.stop();
  });

  it("does not double-report the same node on a rescan", () => {
    const root = document.createElement("div");
    root.innerHTML = tweetHtml("jack", "1");
    document.body.appendChild(root);
    const onTweet = vi.fn();
    const scanner = createTweetScanner(root, onTweet);
    scanner.scanExisting();
    scanner.scanExisting();
    expect(onTweet).toHaveBeenCalledTimes(1);
  });

  it("ignores non-tweet nodes", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onTweet = vi.fn();
    createTweetScanner(root, onTweet).start();
    const cell = document.createElement("div");
    cell.innerHTML = '<div data-testid="UserCell">who to follow</div>';
    root.appendChild(cell);
    await tick();
    expect(onTweet).not.toHaveBeenCalled();
  });
});

describe("scan stats — feeds the selector-health watchdog", () => {
  it("reports mutation batches with their match counts", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const batches: Array<[number, number]> = [];
    const scanner = createTweetScanner(root, () => {}, {
      onScan: (mutations, matches) => batches.push([mutations, matches]),
    });
    scanner.start();

    const noise = document.createElement("div");
    noise.innerHTML = "<span>nothing</span>";
    root.appendChild(noise);
    await tick();

    const cell = document.createElement("div");
    cell.innerHTML = tweetHtml("bob", "3");
    root.appendChild(cell);
    await tick();

    expect(batches.length).toBe(3); // initial scan + two mutation batches
    expect(batches[0]).toEqual([0, 0]); // empty timeline at start()
    expect(batches[1]?.[1]).toBe(0); // noise batch: zero post matches
    expect(batches[2]?.[1]).toBe(1); // tweet batch: one match
    scanner.stop();
  });
});
