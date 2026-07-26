import { afterEach, describe, expect, it, vi } from "vitest";

import { COLLAPSE_CSS, installFilterFeature } from "@/content/filter-feature";
import { createHighContrastHosts } from "@/content/high-contrast-hosts";
import type { HighContrastHosts } from "@/content/high-contrast-hosts";
import * as surfaceMount from "@/content/surface-mount";
import { createFilterStore } from "@/core/filter-store";
import type { FilterStore } from "@/core/filter-store";
import { createSettings } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";

import { installOnChanged } from "../helpers/chrome-fake";

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

  it("keeps every stub visible unless compact mode is on", () => {
    const { article, stub } = mountCollapsedCell();
    (stub.parentElement as HTMLElement).setAttribute("data-lasso-traceless", "");
    expect(getComputedStyle(article).display).toBe("none");
    expect(getComputedStyle(stub).display).toBe("block");
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
 * mock), and a `scope()` fake. Asserts the page <style> + Shadow host wiring,
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

    const highContrastHosts = createHighContrastHosts(settings, false);
    const feature = await installFilterFeature({
      settings,
      highContrastHosts,
      scope: () => ({ kind: "home" }),
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
    highContrastHosts.dispose();
  });

  it("classify collapses a non-matching cell, sync() reapplies over the timeline, unmount() restores all", async () => {
    await persistOnlyJa();
    const settings = createSettings();
    const cell = addCell("en"); // English — collapses under only-ja

    const highContrastHosts = createHighContrastHosts(settings, false);
    const feature = await installFilterFeature({
      settings,
      highContrastHosts,
      scope: () => ({ kind: "home" }),
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
    highContrastHosts.dispose();
  });

  it("unmount clears every filter DOM artifact, including revealed overrides and compact mode", async () => {
    await persistOnlyJa();
    const settings = createSettings();
    const store = createFilterStore();
    const cell = addCell("en");
    const highContrastHosts = createHighContrastHosts(settings, false);
    const feature = await installFilterFeature({
      settings,
      highContrastHosts,
      scope: () => ({ kind: "home" }),
      store,
    });

    feature.classify(articleOf(cell));
    (cell.querySelector("[data-lasso-filter-stub]") as HTMLElement).click();
    store.setCompactHidden(true);
    expect(cell.hasAttribute("data-lasso-show")).toBe(true);
    expect(document.documentElement.hasAttribute("data-lasso-compact")).toBe(true);

    feature.unmount();
    feature.unmount();
    expect(cell.hasAttribute("data-lasso-filtered")).toBe(false);
    expect(cell.querySelector("[data-lasso-filter-stub]")).toBeNull();
    expect(cell.hasAttribute("data-lasso-show")).toBe(false);
    expect(document.documentElement.hasAttribute("data-lasso-compact")).toBe(false);
    highContrastHosts.dispose();
  });

  it("keeps its host live across high-contrast changes", async () => {
    const settings = createSettings();
    const highContrastHosts = createHighContrastHosts(settings, false);
    const feature = await installFilterFeature({
      settings,
      highContrastHosts,
      scope: () => ({ kind: "home" }),
    });
    const surfaceHost = host()!;
    expect(surfaceHost.hasAttribute("data-hc")).toBe(false);
    await settings.set({ highContrast: true });
    expect(surfaceHost.hasAttribute("data-hc")).toBe(true);
    await settings.set({ highContrast: false });
    expect(surfaceHost.hasAttribute("data-hc")).toBe(false);
    feature.unmount();
    await settings.set({ highContrast: true });
    expect(surfaceHost.hasAttribute("data-hc")).toBe(false);
    highContrastHosts.dispose();
  });

  it("is inert out of scope: classify never collapses while scope() is null", async () => {
    await persistOnlyJa();
    const settings = createSettings();
    const cell = addCell("en");
    const highContrastHosts = createHighContrastHosts(settings, false);
    const feature = await installFilterFeature({
      settings,
      highContrastHosts,
      scope: () => null,
    });
    feature.classify(articleOf(cell));
    expect(feature.isStubbed(cell)).toBe(false);
    feature.unmount();
    highContrastHosts.dispose();
  });

  it("leaves a caller-owned store live and unmounts idempotently", async () => {
    const bridge = installOnChanged();
    try {
      const settings = createSettings();
      const highContrastHosts = createHighContrastHosts(settings, false);
      const store = createFilterStore({ navLanguages: ["en"] });
      const feature = await installFilterFeature({
        settings,
        highContrastHosts,
        scope: () => ({ kind: "home" }),
        store,
      });

      feature.unmount();
      feature.unmount();
      bridge.emit(STORAGE_KEYS.filter, { enabled: false });
      expect(store.state.value.enabled).toBe(false);
      highContrastHosts.dispose();
    } finally {
      bridge.restore();
    }
  });

  /**
   * The production apply-on-navigation path (spec #35): sync() is what a route
   * change calls, so this drives it rather than calling store.enterScope
   * directly — otherwise the wiring itself is only ever covered by line count.
   */
  it("applies a scope's bound preset when a route change syncs it", async () => {
    const settings = createSettings();
    const highContrastHosts = createHighContrastHosts(settings, false);
    const store = createFilterStore({ navLanguages: ["en"] });
    store.setMode("kind:link", "only");
    const preset = store.savePreset("Links only");
    store.setMode("kind:link", "off");
    store.bindScope("list:123", preset);

    let scope = { kind: "home" } as ReturnType<Parameters<typeof installFilterFeature>[0]["scope"]>;
    const feature = await installFilterFeature({
      settings,
      highContrastHosts,
      scope: () => scope,
      store,
    });
    await flush();
    expect(store.state.value.criteria).toEqual({}); // Home is unbound

    scope = { kind: "list", listId: "123" };
    feature.sync();
    expect(store.state.value.criteria).toEqual({ "kind:link": "only" });

    feature.unmount();
    highContrastHosts.dispose();
  });

  it("forwards palette intents to its surface manager", async () => {
    const settings = createSettings();
    await settings.set({ surfaces: { pill: false, palette: true }, paletteHotkey: "alt+p" });
    const highContrastHosts = createHighContrastHosts(settings, false);
    const feature = await installFilterFeature({
      settings,
      highContrastHosts,
      scope: () => ({ kind: "home" }),
    });
    await flush();

    expect(feature.paletteHotkey()).toBe("alt+p");
    expect(feature.isPaletteOpen()).toBe(false);
    expect(feature.togglePalette()).toBe(true);
    expect(feature.isPaletteOpen()).toBe(true);
    expect(feature.dismiss()).toBe(true);
    expect(feature.isPaletteOpen()).toBe(false);

    feature.unmount();
    highContrastHosts.dispose();
  });

  it("removes partial setup when host registration fails", async () => {
    const settings = createSettings();
    const cell = addCell("en");
    const highContrastHosts: HighContrastHosts = {
      register: () => {
        throw new Error("host unavailable");
      },
      dispose: () => {},
    };

    await expect(
      installFilterFeature({ settings, highContrastHosts, scope: () => ({ kind: "home" }) }),
    ).rejects.toThrow("host unavailable");

    expect(collapseStyle()).toBeNull();
    expect(host()).toBeNull();
    expect(cell.hasAttribute("data-lasso-filtered")).toBe(false);
  });

  it("removes every setup artifact when surface mounting fails", async () => {
    const settings = createSettings();
    const cell = addCell("en");
    const highContrastHosts = createHighContrastHosts(settings, false);
    const unregister = vi.spyOn(highContrastHosts, "register");
    const mount = vi.spyOn(surfaceMount, "mountFilterSurfaces").mockImplementation(() => {
      throw new Error("surface unavailable");
    });

    try {
      await expect(
        installFilterFeature({ settings, highContrastHosts, scope: () => ({ kind: "home" }) }),
      ).rejects.toThrow("surface unavailable");
      expect(unregister).toHaveBeenCalledTimes(1);
      expect(collapseStyle()).toBeNull();
      expect(host()).toBeNull();
      expect(cell.hasAttribute("data-lasso-filtered")).toBe(false);
    } finally {
      mount.mockRestore();
      highContrastHosts.dispose();
    }
  });

  it("rolls setup back when the first surface sync fails", async () => {
    const settings = createSettings();
    const cell = addCell("en");
    const highContrastHosts = createHighContrastHosts(settings, false);
    const unmount = vi.fn();
    const mount = vi.spyOn(surfaceMount, "mountFilterSurfaces").mockReturnValue({
      update: () => {
        throw new Error("sync unavailable");
      },
      paletteHotkey: () => null,
      togglePalette: () => false,
      isPaletteOpen: () => false,
      dismiss: () => false,
      unmount,
    });

    try {
      await expect(
        installFilterFeature({ settings, highContrastHosts, scope: () => ({ kind: "home" }) }),
      ).rejects.toThrow("sync unavailable");
      expect(unmount).toHaveBeenCalledOnce();
      expect(collapseStyle()).toBeNull();
      expect(host()).toBeNull();
      expect(cell.hasAttribute("data-lasso-filtered")).toBe(false);
    } finally {
      mount.mockRestore();
      highContrastHosts.dispose();
    }
  });

  it("propagates a caller-owned store load failure without disposing it", async () => {
    const settings = createSettings();
    const load = vi.fn(() => Promise.reject(new Error("load unavailable")));
    const dispose = vi.fn();
    const store = { load, dispose } as unknown as FilterStore;
    const highContrastHosts = createHighContrastHosts(settings, false);

    try {
      await expect(
        installFilterFeature({
          settings,
          highContrastHosts,
          scope: () => ({ kind: "home" }),
          store,
        }),
      ).rejects.toThrow("load unavailable");
      expect(dispose).not.toHaveBeenCalled();
      expect(collapseStyle()).toBeNull();
    } finally {
      highContrastHosts.dispose();
    }
  });
});
