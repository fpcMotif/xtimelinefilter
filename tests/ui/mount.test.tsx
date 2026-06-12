import { afterEach, describe, expect, it } from "vitest";

import { attachShadowRoot, createUiRoot, sharedStyleSheet } from "@/ui/mount";

afterEach(() => {
  document.body.innerHTML = "";
});

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
