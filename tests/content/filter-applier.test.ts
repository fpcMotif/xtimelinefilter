import { describe, expect, it } from "vitest";

import { createFilterApplier } from "@/content/filter-applier";
import { createFilterStore } from "@/core/filter-store";

/** A timeline cell wrapping one tweet article, attached under a fresh root. */
function makeRoot(): Element {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}
function addCell(
  root: Element,
  lang: string,
  opts: { video?: boolean; videoComponent?: boolean; repost?: boolean } = {},
): Element {
  const cell = document.createElement("div");
  cell.setAttribute("data-testid", "cellInnerDiv");
  cell.innerHTML =
    `<article data-testid="tweet">` +
    (opts.repost ? `<div data-testid="socialContext">reposted</div>` : "") +
    `<div data-testid="tweetText" lang="${lang}">hi</div>` +
    (opts.video ? `<div data-testid="videoPlayer"></div>` : "") +
    (opts.videoComponent ? `<div data-testid="videoComponent"></div>` : "") +
    `</article>`;
  root.appendChild(cell);
  return cell;
}
const articleOf = (cell: Element) => cell.querySelector('article[data-testid="tweet"]') as Element;

describe("createFilterApplier", () => {
  it("collapses a non-matching cell to a reversible stub (not display:none)", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = addCell(root, "en");
    const applier = createFilterApplier({ store, root, inScope: () => true });

    applier.classify(articleOf(cell));

    expect(applier.isStubbed(cell)).toBe(true);
    expect((cell as HTMLElement).style.display).not.toBe("none");
    const stub = cell.querySelector("[data-lasso-filter-stub]");
    expect(stub?.textContent?.toLowerCase()).toContain("hidden");
    expect(stub?.textContent?.toLowerCase()).toContain("show");
    expect(applier.hiddenCount()).toBe(1);
  });

  it("keeps a matching cell visible", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = addCell(root, "ja");
    const applier = createFilterApplier({ store, root, inScope: () => true });
    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(false);
  });

  it("under 'video only', keeps a reposted video visible and collapses a non-video repost", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.setMode("kind:video", "only");
    const root = makeRoot();
    const original = addCell(root, "en", { video: true });
    const repostVideo = addCell(root, "en", { repost: true, videoComponent: true });
    const repostText = addCell(root, "en", { repost: true });
    const applier = createFilterApplier({ store, root, inScope: () => true });

    applier.reapplyAll();

    expect(applier.isStubbed(original)).toBe(false); // original video — shown
    expect(applier.isStubbed(repostVideo)).toBe(false); // repost OF a video — also shown
    expect(applier.isStubbed(repostText)).toBe(true); // text repost — no video, collapsed
    expect(applier.hiddenCount()).toBe(1);
  });

  it("restores a single post when its stub 'show' is clicked, and keeps it shown on reapply", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = addCell(root, "en");
    const applier = createFilterApplier({ store, root, inScope: () => true });
    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(true);

    (cell.querySelector("[data-lasso-filter-stub]") as HTMLElement).click();
    expect(applier.isStubbed(cell)).toBe(false);

    applier.reapplyAll(); // must respect the explicit show override
    expect(applier.isStubbed(cell)).toBe(false);
  });

  it("re-classifies on every scan, never caching a verdict on the node", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = addCell(root, "en");
    const applier = createFilterApplier({ store, root, inScope: () => true });
    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(true);

    // The node now represents a Japanese tweet — verdict must be recomputed.
    cell.querySelector('[data-testid="tweetText"]')?.setAttribute("lang", "ja");
    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(false);
  });

  it("re-reveals a 'video only' post when X hydrates its video player after mount", async () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.setMode("kind:video", "only");
    const root = makeRoot();
    // Mounts as a poster only — X hasn't hydrated the <video> player yet, so the
    // post is byte-for-byte indistinguishable from a photo at classify time.
    const cell = addCell(root, "en");
    const applier = createFilterApplier({ store, root, inScope: () => true });

    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(true); // looks non-video → collapsed

    // X hydrates the video player into the already-classified article.
    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoPlayer");
    articleOf(cell).appendChild(player);
    await new Promise((r) => setTimeout(r, 0)); // let the hydration observer fire

    expect(applier.isStubbed(cell)).toBe(false); // now detected as video → revealed
    applier.dispose();
  });

  it("hides a 'video hide' post when X hydrates its video player after mount", async () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.setMode("kind:video", "hide");
    const root = makeRoot();
    const cell = addCell(root, "en"); // poster only at mount → no video facet yet
    const applier = createFilterApplier({ store, root, inScope: () => true });

    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(false); // no video yet → shown

    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoComponent");
    articleOf(cell).appendChild(player);
    await new Promise((r) => setTimeout(r, 0));

    expect(applier.isStubbed(cell)).toBe(true); // video hydrated → now hidden
    applier.dispose();
  });

  it("hides a REPOSTED video under 'video hide' once its player hydrates (a repost of a video is a video)", async () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.setMode("kind:video", "hide");
    const root = makeRoot();
    // A repost whose embedded video hasn't hydrated yet — poster only, so it reads
    // as non-video at mount and (under hide) wrongly stays shown.
    const cell = addCell(root, "en", { repost: true });
    const applier = createFilterApplier({ store, root, inScope: () => true });
    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(false); // no video facet yet → shown

    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoPlayer");
    articleOf(cell).appendChild(player); // X hydrates the reposted video's player
    await new Promise((r) => setTimeout(r, 0));

    // The video sits inside the reposted body, so it's still a video — now hidden.
    expect(applier.isStubbed(cell)).toBe(true);
    applier.dispose();
  });

  it("drops a stale 'show' override when a cell is recycled to a different tweet", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = addCell(root, "en"); // non-matching → collapses
    const applier = createFilterApplier({ store, root, inScope: () => true });
    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(true);

    // The user un-hides THIS post via its stub.
    (cell.querySelector("[data-lasso-filter-stub]") as HTMLElement).click();
    expect(applier.isStubbed(cell)).toBe(false);

    // X recycles the cell for a DIFFERENT (still non-matching) tweet.
    cell.querySelector('[data-testid="tweetText"]')!.textContent = "a different post";
    applier.classify(articleOf(cell));

    // The override is keyed to the original post, so it must not leak — the
    // recycled tweet collapses again.
    expect(applier.isStubbed(cell)).toBe(true);
  });

  it("reveals everything while revealed is true (filter stays armed), then re-applies on resume", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    addCell(root, "en");
    addCell(root, "fr");
    const applier = createFilterApplier({ store, root, inScope: () => true });
    applier.reapplyAll();
    expect(applier.hiddenCount()).toBe(2);

    store.setRevealed(true); // "show all hidden" peek — applier reapplies via effect
    expect(applier.hiddenCount()).toBe(0);
    expect(store.state.value.enabled).toBe(true); // still armed, not disabled

    store.setRevealed(false); // resume
    expect(applier.hiddenCount()).toBe(2);
  });

  it("reflects compactHidden as a page-level data-lasso-compact flag (CSS hides the stub)", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    addCell(root, "en");
    createFilterApplier({ store, root, inScope: () => true });

    expect(root.hasAttribute("data-lasso-compact")).toBe(false);
    store.setCompactHidden(true);
    expect(root.hasAttribute("data-lasso-compact")).toBe(true);
    store.setCompactHidden(false);
    expect(root.hasAttribute("data-lasso-compact")).toBe(false);
  });

  it("restores everything when the master toggle goes off", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const a = addCell(root, "en");
    const b = addCell(root, "fr");
    const applier = createFilterApplier({ store, root, inScope: () => true });
    applier.reapplyAll();
    expect(applier.hiddenCount()).toBe(2);

    store.setEnabled(false); // applier subscribes to the store and reapplies
    expect(applier.isStubbed(a)).toBe(false);
    expect(applier.isStubbed(b)).toBe(false);
    expect(applier.hiddenCount()).toBe(0);
  });

  it("does nothing off-route, then resumes when back in scope", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = addCell(root, "en");
    let scope = false;
    const applier = createFilterApplier({ store, root, inScope: () => scope });

    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(false); // off-route: inert

    scope = true;
    applier.reapplyAll();
    expect(applier.isStubbed(cell)).toBe(true);
  });

  it("fails open: an unclassifiable post is shown, never hidden, and never throws", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = document.createElement("div");
    cell.setAttribute("data-testid", "cellInnerDiv");
    cell.innerHTML = `<article data-testid="tweet"></article>`; // no text, no lang
    root.appendChild(cell);
    const applier = createFilterApplier({ store, root, inScope: () => true });
    expect(() => applier.classify(articleOf(cell))).not.toThrow();
    expect(applier.isStubbed(cell)).toBe(false);
  });

  it("fail-open catch restores an already-hidden cell when classification throws", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = addCell(root, "en"); // non-matching → would collapse
    let crash = false;
    const applier = createFilterApplier({
      store,
      root,
      inScope: () => {
        if (crash) throw new Error("boom"); // throw INSIDE classify's try, after closest()
        return true;
      },
    });

    applier.classify(articleOf(cell)); // collapses normally
    expect(applier.isStubbed(cell)).toBe(true);

    crash = true; // next classify throws → catch finds the cell and restores it
    expect(() => applier.classify(articleOf(cell))).not.toThrow();
    expect(applier.isStubbed(cell)).toBe(false);
  });

  it("fail-open catch no-ops when the throwing article has no closest()", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const applier = createFilterApplier({ store, root, inScope: () => true });

    // `closest` is undefined → the first `article.closest(...)` throws, then the
    // catch's optional `article.closest?.(...)` short-circuits to undefined (no cell).
    const bogus = { closest: undefined } as unknown as Element;
    expect(() => applier.classify(bogus)).not.toThrow();
  });

  it("falls back to an empty identity when a collapsed post has neither permalink nor text", () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.setMode("kind:video", "only"); // non-video collapses, no text needed
    const root = makeRoot();
    // A cell whose article has no status link and no tweetText element at all.
    const cell = document.createElement("div");
    cell.setAttribute("data-testid", "cellInnerDiv");
    cell.innerHTML = `<article data-testid="tweet"><div data-testid="tweetPhoto"></div></article>`;
    root.appendChild(cell);
    const applier = createFilterApplier({ store, root, inScope: () => true });

    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(true); // a photo-only post under "video only" → hidden

    // Clicking the stub stamps SHOW with identity() → "" (no id, no text).
    (cell.querySelector("[data-lasso-filter-stub]") as HTMLElement).click();
    expect(cell.getAttribute("data-lasso-show")).toBe("");
    expect(applier.isStubbed(cell)).toBe(false);
  });

  it("tolerates a bodyless document root (no observer target, no compact-flag host)", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    // A fresh Document has documentElement === null and body === null — the pre-parse
    // state the applier's optional-chain / observer guards defend against.
    const doc = new Document();
    const cell = doc.createElement("div");
    cell.setAttribute("data-testid", "cellInnerDiv");
    cell.innerHTML = `<article data-testid="tweet"><div data-testid="tweetText" lang="en">hi</div></article>`;
    doc.appendChild(cell);

    const applier = createFilterApplier({ store, root: doc, inScope: () => true });
    // Effect already ran reapplyAll over the bodyless doc; classify still works.
    expect(() => applier.reapplyAll()).not.toThrow();
    expect(applier.isStubbed(cell)).toBe(true); // English under only-ja → hidden
    // Flipping compactHidden is a no-op (no documentElement to flag) but must not throw.
    expect(() => store.setCompactHidden(true)).not.toThrow();
    applier.dispose();
  });

  it("ignores an orphan article that has no enclosing cell", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const applier = createFilterApplier({ store, root, inScope: () => true });
    const orphan = document.createElement("article"); // no cellInnerDiv ancestor
    orphan.setAttribute("data-testid", "tweet");
    expect(() => applier.classify(orphan)).not.toThrow();
  });

  it("reapplyAll() skips a cell that holds no tweet article", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const empty = document.createElement("div");
    empty.setAttribute("data-testid", "cellInnerDiv"); // a cell with no <article> inside
    root.appendChild(empty);
    const applier = createFilterApplier({ store, root, inScope: () => true });
    expect(() => applier.reapplyAll()).not.toThrow();
    expect(applier.hiddenCount()).toBe(0);
  });

  it("keys the 'show' override on the status id when the permalink is present", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const cell = addCell(root, "en");
    // Give the article a real status permalink so identity() resolves the id path.
    const link = document.createElement("a");
    link.setAttribute("href", "/jack/status/12345");
    articleOf(cell).appendChild(link);
    const applier = createFilterApplier({ store, root, inScope: () => true });

    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(true);

    (cell.querySelector("[data-lasso-filter-stub]") as HTMLElement).click(); // stamps SHOW=12345
    expect(cell.getAttribute("data-lasso-show")).toBe("12345");

    applier.reapplyAll(); // same status id → override honoured, stays shown
    expect(applier.isStubbed(cell)).toBe(false);
  });

  it("uses the whole document as the scan root (data-lasso-compact lands on <html>, observer on body)", async () => {
    const store = createFilterStore({ navLanguages: ["en"] });
    store.setMode("kind:video", "only");
    // Cell lives directly under the real document body so root === document works.
    const cell = document.createElement("div");
    cell.setAttribute("data-testid", "cellInnerDiv");
    cell.innerHTML = `<article data-testid="tweet"><div data-testid="tweetText" lang="en">hi</div></article>`;
    document.body.appendChild(cell);
    const applier = createFilterApplier({ store, root: document, inScope: () => true });

    applier.classify(articleOf(cell));
    expect(applier.isStubbed(cell)).toBe(true); // non-video under "video only" → hidden

    // Compact flag toggles on the documentElement (the document-root branch).
    store.setCompactHidden(true);
    expect(document.documentElement.hasAttribute("data-lasso-compact")).toBe(true);
    store.setCompactHidden(false);

    // The hydration observer is watching document.body: hydrate a video player in.
    const player = document.createElement("div");
    player.setAttribute("data-testid", "videoPlayer");
    articleOf(cell).appendChild(player);
    await new Promise((r) => setTimeout(r, 0));
    expect(applier.isStubbed(cell)).toBe(false); // now a video → revealed

    applier.dispose();
    cell.remove();
    document.documentElement.removeAttribute("data-lasso-compact");
  });

  it("restoreAll() un-collapses every cell the filter hid", () => {
    const store = createFilterStore({ navLanguages: ["ja"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const root = makeRoot();
    const a = addCell(root, "en");
    const b = addCell(root, "fr");
    const applier = createFilterApplier({ store, root, inScope: () => true });
    applier.reapplyAll();
    expect(applier.hiddenCount()).toBe(2);

    applier.restoreAll();
    expect(applier.isStubbed(a)).toBe(false);
    expect(applier.isStubbed(b)).toBe(false);
    expect(applier.hiddenCount()).toBe(0);
  });
});
