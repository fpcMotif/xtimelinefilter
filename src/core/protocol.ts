/**
 * The extension's cross-context wire contract: content script ⇄ background
 * service worker ⇄ popup, plus the MAIN-world caret-activation handshake.
 * Every literal below is frozen wire format — do not rename or normalize
 * ("lasso:badge" / "lasso:state" / "lasso:status" / "lasso-activate" keep
 * their colon/hyphen inconsistency on purpose).
 */

/** content → background: mirrors the live selection count onto the toolbar badge. */
export interface BadgeMessage {
  type: "lasso:badge";
  count: number;
}

/** content → background: "awake" clears any "zz" badge, "asleep" sets it. */
export interface StateMessage {
  type: "lasso:state";
  state: "awake" | "asleep";
}

/** popup → content: "is this tab's content script awake?" */
export interface StatusRequest {
  type: "lasso:status";
}

/** popup → content: wake an on-demand tab (ADR-0006). */
export interface ActivateRequest {
  type: "lasso-activate";
}

export type LassoMessage = BadgeMessage | StateMessage | StatusRequest | ActivateRequest;

/** content's sendResponse payload for a StatusRequest. */
export interface LassoStatusResponse {
  awake: boolean;
}

/** Narrows an onMessage payload of unknown shape to a known LassoMessage. */
export function isLassoMessage(msg: unknown): msg is LassoMessage {
  if (typeof msg !== "object" || msg === null || !("type" in msg)) return false;
  const { type } = msg as { type: unknown };
  switch (type) {
    case "lasso:badge":
      return typeof (msg as BadgeMessage).count === "number";
    case "lasso:state":
      return (msg as StateMessage).state === "awake" || (msg as StateMessage).state === "asleep";
    case "lasso:status":
    case "lasso-activate":
      return true;
    default:
      return false;
  }
}

/** Best-effort runtime messaging — never lets a dead SW break the page UI. */
export function sendToBackground(msg: LassoMessage): void {
  try {
    void chrome.runtime?.sendMessage?.(msg)?.catch?.(() => {});
  } catch {
    // extension context gone (reload) — ignore
  }
}

/** Sends a message to a specific tab's content script (e.g. from the popup). */
export function sendToTab(tabId: number, msg: LassoMessage): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, msg);
}

// MAIN-world caret-activation handshake (src/content/main-world.ts ⇄
// src/core/x-client/caret-actions.ts): some X caret rows ignore isolated-world
// synthetic events, so the isolated content script posts a window message the
// MAIN-world script answers by dispatching the click itself. Frozen wire format.
export const PAGE_ACTIVATE_CHANNEL = "__lasso_x_main_world_activate__";
export const PAGE_ACTIVATE_REQUEST = "activate";
export const PAGE_ACTIVATE_RESPONSE = "activated";
export const PAGE_ACTIVATE_READY = "data-lasso-main-world-activate";
export const PAGE_ACTIVATE_TARGET = "data-lasso-activate-target";
