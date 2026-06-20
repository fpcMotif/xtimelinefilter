import { type ComponentChild, render } from "preact";

import tailwindCss from "./styles.css?inline";

// Tailwind emits theme vars and preflight to :root; rewrite to :host so they
// apply inside the Shadow DOM (utilities resolve their var() references there).
const shadowCss = tailwindCss.replaceAll(":root", ":host");

// Tailwind v4 declares its utility state vars (--tw-shadow, --tw-border-style,
// --tw-scale-*, …) with @property. @property only registers at the DOCUMENT
// level — inside a shadow root (adoptedStyleSheets) those registrations are
// ignored, so the vars have no initial value and any utility that composes them
// silently collapses: border-style → none (⇒ 0-width borders), box-shadow → none,
// ring/transform become no-ops. Mirror just the @property blocks into one
// document-level <style> so the shadow-DOM utilities resolve correctly.
const twPropertyRules = shadowCss.match(/@property[^{]+\{[^}]*\}/g)?.join("") ?? "";
let twPropertiesInstalled = false;
function installTwProperties(): void {
  if (twPropertiesInstalled || !twPropertyRules || typeof document === "undefined") return;
  twPropertiesInstalled = true;
  const style = document.createElement("style");
  style.setAttribute("data-lasso-tw-properties", "");
  style.textContent = twPropertyRules;
  (document.head ?? document.documentElement).appendChild(style);
}

let sheet: CSSStyleSheet | undefined;

/** One constructable stylesheet shared by the main UI root and every overlay root. */
export function sharedStyleSheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(shadowCss);
  }
  return sheet;
}

/** Attach an open Shadow DOM with the shared theme, returning a Preact mount point. */
export function attachShadowRoot(host: HTMLElement): { root: ShadowRoot; mount: HTMLElement } {
  installTwProperties();
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [sharedStyleSheet()];
  const mount = document.createElement("div");
  root.appendChild(mount);
  return { root, mount };
}

export interface UiRoot {
  host: HTMLElement;
  root: ShadowRoot;
  render(node: ComponentChild): void;
  destroy(): void;
}

/**
 * Creates the top-level Shadow DOM UI root (ADR-0003: style isolation from x.com,
 * no innerHTML of fetched data). The Preact tree renders into a node inside it.
 */
export function createUiRoot(id = "lasso-root"): UiRoot {
  const host = document.createElement("div");
  host.id = id;
  host.style.all = "initial";
  const { root, mount } = attachShadowRoot(host);
  document.body.appendChild(host);

  return {
    host,
    root,
    render: (node) => render(node, mount),
    destroy: () => {
      render(null, mount);
      host.remove();
    },
  };
}
