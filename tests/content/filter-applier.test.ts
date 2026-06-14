import { describe, expect, it } from "vitest";

import { createFilterApplier } from "@/content/filter-applier";
import { createFilterStore } from "@/core/filter-store";

/** A timeline cell wrapping one tweet article, attached under a fresh root. */
function makeRoot(): Element {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}
function addCell(root: Element, lang: string, opts: { video?: boolean } = {}): Element {
  const cell = document.createElement("div");
  cell.setAttribute("data-testid", "cellInnerDiv");
  cell.innerHTML =
    `<article data-testid="tweet">` +
    `<div data-testid="tweetText" lang="${lang}">hi</div>` +
    (opts.video ? `<div data-testid="videoPlayer"></div>` : "") +
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
});
