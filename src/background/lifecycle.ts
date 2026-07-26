import type { ContentToBackground } from "@/core/protocol";

import type { BadgePresentation } from "./tab-badge-writer";

/**
 * Pure background logic (testable without chrome.*): the install moment opens
 * the product itself as the tour (story beat 2), and the toolbar badge mirrors
 * the content script's live state (beats 7 & 9). index.ts wires chrome events.
 */

/** The product IS the tour: land where the value lives. */
export const WELCOME_URL = "https://x.com/home#lasso-welcome";

/**
 * One-question exit form (story beat 10) — the only telemetry Lasso will ever
 * have. Hosted off-extension; update when the form moves.
 */
export const UNINSTALL_FORM_URL =
  "https://github.com/fpcMotif/xtimelinefilter/issues/new?labels=uninstall-feedback&title=What%20made%20you%20remove%20Lasso%3F";

export interface InstallApi {
  createTab(url: string): void;
  setUninstallURL(url: string): void;
}

export function handleInstalled(details: { reason: string }, api: InstallApi): void {
  if (details.reason === "install") api.createTab(WELCOME_URL);
  api.setUninstallURL(UNINSTALL_FORM_URL);
}

/** Complete visual state for a badge message, or null when unrelated. */
export function badgePresentationFor(msg: ContentToBackground): BadgePresentation;
export function badgePresentationFor(msg: undefined): null;
export function badgePresentationFor(
  msg: ContentToBackground | undefined,
): BadgePresentation | null {
  if (msg?.type === "lasso:badge") {
    return msg.count > 0 ? { text: String(msg.count), backgroundColor: "#1d9bf0" } : { text: "" };
  }
  if (msg?.type === "lasso:state") {
    return msg.state === "asleep" ? { text: "zz", backgroundColor: "#536471" } : { text: "" };
  }
  return null;
}
