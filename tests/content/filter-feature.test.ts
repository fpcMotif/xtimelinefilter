import { afterEach, describe, expect, it } from "vitest";

import { COLLAPSE_CSS, installFilterFeature } from "@/content/filter-feature";
import { createSettings } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";

/**
 * Guards the page-injected collapse CSS — the part that actually makes a hidden
 * cell disappear. The applier sets the `data-lasso-filtered` / `data-lasso-compact`
 * markers (covered in filter-applier.test); this ties those markers to the CSS
 * that hides the content, so a renamed marker or dropped rule fails loudly here.
 */
describe("COLLAPSE_CSS", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-lasso-compact");
    document.head.querySelectorAll("style[data-test-collapse]").forEach((s) => s.remove());
    document.body.replaceChildren();
  });

  function mountCollapsedCell(): { article: HTMLElement; stub: HTMLElement } {
    const style = document.createElement("style");
    style.setAttribute("data-test-collapse", "");
    style.textContent = COLLAPSE_CSS;
    document.head.appendChild(style);

    const cell = document.createElement("div");
    cell.setAttribute("data-testid", "cellInnerDiv");
    cell.setAttribute("data-lasso-filtered", "");
    const stub = document.createElement("div");
    stub.setAttribute("data-lasso-filter-stub", "");
    stub.textContent = "· hidden — show";
    const article = document.createElement("article");
    article.textContent = "the post";
    cell.append(stub, article);
    document.body.appendChild(cell);
    return { article, stub };
  }

  it("hides the post content but keeps the stub visible by default (stub mode)", () => {
    const { article, stub } = mountCollapsedCell();
    expect(getComputedStyle(article).display).toBe("none");
    expect(getComputedStyle(stub).display).toBe("block");
  });

  it("also hides the stub once data-lasso-compact is set (0-height compact mode)", () => {
    const { article, stub } = mountCollapsedCell();
    document.documentElement.setAttribute("data-lasso-compact", "");
    expect(getComputedStyle(article).display).toBe("none");
    expect(getComputedStyle(stub).display).toBe("none");
  });
});

/** Let the surface manager settle its initial async settings.get(). */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Persist a filter config so the feature's store loads it (only-my-languages: ja). */
async function persistOnlyJa(): Promise<void> {
  await (
    chrome.storage.sync as unknown as { set(items: Record<string, unknown>): Promise<void> }
  ).set({
    [STORAGE_KEYS.filter]: {
      enabled: true,
      criteria: {},
      onlyMyLanguages: true,
      myLanguages: ["ja"],
      linkRules: [],
      presets: [],
      compactHidden: false,
    },
  });
}

/**
 * Drives the real `installFilterFeature` end-to-end: a synthetic timeline cell in
 * `document`, a real persisted SettingsStore (createSettings over the chrome.storage
 * mock), and an `inScope()` fake. Asserts the page <style> + Shadow host wiring,
 * that classify/isStubbed delegate to the live applier, that sync() reapplies, and
 * that unmount() removes everything it added.
 */
/** One timeline cell wrapping a tweet in `lang` (English collapses under only-ja). */
function addCell(lang = "en"): HTMLElement {
  const cell = document.createElement("div");
  cell.setAttribute("data-testid", "cellInnerDiv");
  cell.innerHTML =
    `<article data-testid="tweet">` +
    `<div data-testid="tweetText" lang="${lang}">hi</div>` +
    `</article>`;
  document.body.appendChild(cell);
  return cell;
}
const articleOf = (cell: Element) => cell.querySelector('article[data-testid="tweet"]') as Element;
const collapseStyle = () =>
  [...document.head.querySelectorAll("style")].find((s) => s.textContent === COLLAPSE_CSS) ?? null;
const host = () => document.getElementById("lasso-filter-surfaces");

describe("installFilterFeature", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.head.querySelectorAll("style").forEach((s) => {
      if (s.textContent === COLLAPSE_CSS) s.remove();
    });
    document.querySelectorAll("#lasso-filter-surfaces").forEach((h) => h.remove());
    document.documentElement.removeAttribute("data-lasso-compact");
  });

  it("installs the collapse <style> + Shadow host, mounts the default pill, and classify delegates", async () => {
    const settings = createSettings();
    const cell = addCell("en");

    const feature = await installFilterFeature({
      settings,
      highContrast: false,
      inScope: () => true,
    });
    await flush(); // let the surface manager settle its async settings.get() and mount the pill

    // The page-level collapse CSS is injected into <head>, and the surfaces host
    // is attached to the body with an open Shadow root.
    expect(collapseStyle()).toBeTruthy();
    const surfaceHost = host()!;
    expect(surfaceHost).toBeTruthy();
    expect(surfaceHost.shadowRoot).toBeTruthy();
    expect(surfaceHost.hasAttribute("data-hc")).toBe(false); // not high-contrast

    // The default pill surface (surfaces.pill: true) renders into the Shadow root.
    const shadow = surfaceHost.shadowRoot!;
    expect(shadow.querySelector("[data-funnel-pill-root]")).toBeTruthy();

    // Opening the pill mounts its <FilterPanel>, which reads hiddenCount() — the
    // seam the feature wires from the applier to the surface manager (line 66).
    const pillButton = shadow.querySelector("[data-funnel-pill-root] button") as HTMLElement;
    pillButton.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await flush(); // Preact batches the setOpen state update
    expect(shadow.querySelector('[role="dialog"]')).toBeTruthy(); // popover opened

    // No criteria persisted → classify delegates to the applier but keeps it shown.
    feature.classify(articleOf(cell));
    expect(feature.isStubbed(cell)).toBe(false);

    feature.unmount();
  });

  it("classify collapses a non-matching cell, sync() reapplies over the timeline, unmount() restores all", async () => {
    await persistOnlyJa();
    const settings = createSettings();
    const cell = addCell("en"); // English — collapses under only-ja

    const feature = await installFilterFeature({
      settings,
      highContrast: false,
      inScope: () => true,
    });

    feature.classify(articleOf(cell));
    expect(feature.isStubbed(cell)).toBe(true);

    // A second cell added after install is only collapsed once we sync() (reapplyAll).
    const cell2 = addCell("fr");
    expect(feature.isStubbed(cell2)).toBe(false);
    feature.sync();
    expect(feature.isStubbed(cell2)).toBe(true);

    feature.unmount();
    // unmount restores: both cells are no longer stubbed and the host/style are gone.
    expect(feature.isStubbed(cell)).toBe(false);
    expect(feature.isStubbed(cell2)).toBe(false);
    expect(collapseStyle()).toBeNull();
    expect(host()).toBeNull();
  });

  it("sets data-hc on the surface host when highContrast is true", async () => {
    const settings = createSettings();
    const feature = await installFilterFeature({
      settings,
      highContrast: true,
      inScope: () => true,
    });
    expect(host()!.hasAttribute("data-hc")).toBe(true);
    feature.unmount();
  });

  it("is inert out of scope: classify never collapses while inScope() is false", async () => {
    await persistOnlyJa();
    const settings = createSettings();
    const cell = addCell("en");
    const feature = await installFilterFeature({
      settings,
      highContrast: false,
      inScope: () => false,
    });
    feature.classify(articleOf(cell));
    expect(feature.isStubbed(cell)).toBe(false);
    feature.unmount();
  });
});
