import { afterEach, describe, expect, it, vi } from "vitest";

import { attachShadowRoot, createUiRoot, sharedStyleSheet } from "@/ui/mount";

afterEach(() => {
  document.body.innerHTML = "";
  document.head.querySelectorAll("style[data-lasso-tw-properties]").forEach((n) => n.remove());
});

const PROPERTY_CSS =
  ':root{--a:1}\n@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}\n';

/** Re-import mount with a mocked stylesheet so the @property mirror has rules to install. */
async function importMountWithProperties(css = PROPERTY_CSS) {
  vi.resetModules();
  vi.doMock("@/ui/styles.css?inline", () => ({ default: css }));
  const mod = await import("@/ui/mount");
  return mod;
}

describe("sharedStyleSheet", () => {
  it("creates one constructable stylesheet and reuses it", () => {
    const first = sharedStyleSheet();
    const second = sharedStyleSheet();
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(CSSStyleSheet);
  });
});

describe("attachShadowRoot", () => {
  it("attaches an open shadow root with the shared stylesheet and mount node", () => {
    const host = document.createElement("div");
    const { root, mount } = attachShadowRoot(host);

    expect(host.shadowRoot).toBe(root);
    expect(root.adoptedStyleSheets).toEqual([sharedStyleSheet()]);
    expect(root.firstElementChild).toBe(mount);
  });
});

describe("createUiRoot", () => {
  it("renders into and destroys the top-level shadow root", () => {
    const ui = createUiRoot("test-lasso-root");
    expect(ui.host.id).toBe("test-lasso-root");
    expect(ui.host.style.all).toBe("initial");
    expect(document.body.contains(ui.host)).toBe(true);

    ui.render(<button type="button">Hello</button>);
    expect(ui.root.textContent).toContain("Hello");

    ui.destroy();
    expect(document.body.contains(ui.host)).toBe(false);
  });
});

describe("installTwProperties (document-level @property mirror)", () => {
  afterEach(() => {
    vi.doUnmock("@/ui/styles.css?inline");
    vi.resetModules();
  });

  it("does nothing when the inlined stylesheet has no @property rules", () => {
    // The statically-imported module sees the (empty) test stylesheet.
    const host = document.createElement("div");
    attachShadowRoot(host);
    expect(document.head.querySelector("style[data-lasso-tw-properties]")).toBeNull();
  });

  it("mirrors the @property rules into one document-level <style>, then no-ops", async () => {
    const mod = await importMountWithProperties();
    mod.attachShadowRoot(document.createElement("div"));
    const styles = document.head.querySelectorAll("style[data-lasso-tw-properties]");
    expect(styles.length).toBe(1);
    expect(styles[0]!.textContent).toContain("@property --tw-shadow");
    // A second attach hits the `twPropertiesInstalled` latch and installs nothing more.
    mod.attachShadowRoot(document.createElement("div"));
    expect(document.head.querySelectorAll("style[data-lasso-tw-properties]").length).toBe(1);
  });

  it("falls back to documentElement when document.head is absent", async () => {
    const mod = await importMountWithProperties();
    const head = document.head;
    Object.defineProperty(document, "head", { configurable: true, get: () => null });
    try {
      mod.attachShadowRoot(document.createElement("div"));
      expect(
        document.documentElement.querySelector("style[data-lasso-tw-properties]"),
      ).toBeTruthy();
    } finally {
      Object.defineProperty(document, "head", { configurable: true, get: () => head });
    }
  });

  it("guards the @property install against a missing global document", async () => {
    const mod = await importMountWithProperties();
    const realDoc = globalThis.document;
    // A host whose attachShadow is a no-op so attachShadowRoot reaches the install
    // first, where the `typeof document === "undefined"` guard must return early.
    const host = { attachShadow: () => ({ adoptedStyleSheets: [], appendChild() {} }) };
    // @ts-expect-error — exercise the `typeof document === "undefined"` guard.
    delete globalThis.document;
    try {
      // installTwProperties runs first and returns at the guard; the later
      // document.createElement then throws because document is gone.
      expect(() => mod.attachShadowRoot(host as unknown as HTMLElement)).toThrow();
    } finally {
      globalThis.document = realDoc;
    }
    // No style was installed while document was undefined.
    expect(document.head.querySelector("style[data-lasso-tw-properties]")).toBeNull();
  });
});
