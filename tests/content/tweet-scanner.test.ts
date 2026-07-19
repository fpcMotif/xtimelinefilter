import { afterEach, describe, expect, it, vi } from "vitest";

import { createTweetScanner } from "@/content/tweet-scanner";

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

    const seen: Element[] = [];
    createTweetScanner(root, (article) => seen.push(article)).start();
    expect(
      seen.map((article) => article.querySelector("time")?.closest("a")?.getAttribute("href")),
    ).toEqual(["/jack/status/1", "/alice/status/2"]);
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
    expect(onTweet).toHaveBeenCalledWith(cell.querySelector("article"));
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

    expect(onTweet).toHaveBeenCalledWith(article);
    scanner.stop();
  });

  it("reports an Author-less tweet once", async () => {
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

    expect(onTweet).toHaveBeenCalledWith(article);
    expect(onTweet).toHaveBeenCalledTimes(1);
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

describe("virtualization pruning — onTweetRemoved (overlay disposal hook)", () => {
  it("reports a pruned article once and re-reports the node if X re-adds it", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onTweet = vi.fn();
    const onTweetRemoved = vi.fn();
    const scanner = createTweetScanner(root, onTweet, { onTweetRemoved });
    scanner.start();

    const cell = document.createElement("div");
    cell.innerHTML = tweetHtml("bob", "3");
    const article = cell.querySelector("article") as Element;
    root.appendChild(cell);
    await tick();
    expect(onTweet).toHaveBeenCalledTimes(1);

    cell.remove(); // X prunes the whole cell, not the bare article
    await tick();
    expect(onTweetRemoved).toHaveBeenCalledTimes(1);
    expect(onTweetRemoved).toHaveBeenCalledWith(article);

    root.appendChild(cell); // re-mounted → forgotten node is reported again
    await tick();
    expect(onTweet).toHaveBeenCalledTimes(2);
    scanner.stop();
  });

  it("reports a directly-removed article node", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onTweetRemoved = vi.fn();
    const scanner = createTweetScanner(root, () => {}, { onTweetRemoved });
    scanner.start();

    const holder = document.createElement("div");
    holder.innerHTML = tweetHtml("amy", "5");
    const article = holder.querySelector("article") as Element;
    root.appendChild(article);
    await tick();

    root.removeChild(article);
    await tick();
    expect(onTweetRemoved).toHaveBeenCalledWith(article);
    scanner.stop();
  });

  it("keeps an article that was reparented within one mutation batch", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onTweetRemoved = vi.fn();
    const scanner = createTweetScanner(root, () => {}, { onTweetRemoved });
    scanner.start();

    const cellA = document.createElement("div");
    cellA.innerHTML = tweetHtml("bob", "3");
    const article = cellA.querySelector("article") as Element;
    const cellB = document.createElement("div");
    root.append(cellA, cellB);
    await tick();

    cellB.appendChild(article); // remove + re-add settle before the callback runs
    await tick();
    expect(onTweetRemoved).not.toHaveBeenCalled();
    scanner.stop();
  });

  it("ignores removed nodes it never reported (and non-element removals)", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onTweetRemoved = vi.fn();
    const scanner = createTweetScanner(root, () => {}, { onTweetRemoved });
    scanner.start();

    // A childList-only observer never sees this article: it enters the DOM as a
    // plain <article> and only *then* gains the tweet testid (attribute change).
    const stealth = document.createElement("article");
    root.appendChild(stealth);
    const text = document.createTextNode("noise");
    root.appendChild(text);
    await tick();
    stealth.setAttribute("data-testid", "tweet");

    root.removeChild(stealth);
    root.removeChild(text);
    await tick();
    expect(onTweetRemoved).not.toHaveBeenCalled();
    scanner.stop();
  });

  it("prunes silently when no onTweetRemoved is wired", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const scanner = createTweetScanner(root, () => {});
    scanner.start();
    const cell = document.createElement("div");
    cell.innerHTML = tweetHtml("bob", "3");
    root.appendChild(cell);
    await tick();
    cell.remove();
    await tick(); // must not throw
    scanner.stop();
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
