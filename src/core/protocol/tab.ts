/** Tab-context messages and the MAIN-world activation bridge. */

export interface BadgeMessage {
  type: "lasso:badge";
  count: number;
}

export interface StateMessage {
  type: "lasso:state";
  state: "awake" | "asleep";
}

export interface StatusRequest {
  type: "lasso:status";
}

export interface ActivateRequest {
  type: "lasso-activate";
}

export interface ClearDataRequest {
  type: "lasso:clear-data";
}

export interface ClearDataResponse {
  localCleared: boolean;
  syncCleared: boolean;
}

export type ContentToBackground = BadgeMessage | StateMessage;
export type PopupToContent = StatusRequest | ActivateRequest;
export interface LassoStatusResponse {
  awake: boolean;
}

function hasType(msg: unknown): msg is Record<string, unknown> & { type: unknown } {
  return typeof msg === "object" && msg !== null && "type" in msg;
}

export function isContentToBackgroundMessage(msg: unknown): msg is ContentToBackground {
  if (!hasType(msg)) return false;
  switch (msg.type) {
    case "lasso:badge":
      return (
        "count" in msg &&
        typeof msg.count === "number" &&
        Number.isSafeInteger(msg.count) &&
        msg.count >= 0
      );
    case "lasso:state":
      return "state" in msg && (msg.state === "awake" || msg.state === "asleep");
    default:
      return false;
  }
}

export function isPopupToContentMessage(msg: unknown): msg is PopupToContent {
  return hasType(msg) && (msg.type === "lasso:status" || msg.type === "lasso-activate");
}

export function isClearDataRequest(msg: unknown): msg is ClearDataRequest {
  return hasType(msg) && msg.type === "lasso:clear-data";
}

export function requestLassoDataClear(): Promise<ClearDataResponse> {
  return chrome.runtime.sendMessage({ type: "lasso:clear-data" }).then((response: unknown) => {
    if (
      typeof response !== "object" ||
      response === null ||
      !("localCleared" in response) ||
      !("syncCleared" in response) ||
      typeof response.localCleared !== "boolean" ||
      typeof response.syncCleared !== "boolean"
    ) {
      throw new Error("Invalid clear-data response");
    }
    return { localCleared: response.localCleared, syncCleared: response.syncCleared };
  });
}

/** Best-effort runtime messaging — never lets a dead SW break the page UI. */
export function sendToBackground(msg: ContentToBackground): void {
  try {
    void chrome.runtime?.sendMessage?.(msg)?.catch?.(() => {});
  } catch {
    // extension context gone (reload) — ignore
  }
}

export function sendToTab(tabId: number, msg: PopupToContent): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, msg);
}

export const PAGE_ACTIVATE_CHANNEL = "__lasso_x_main_world_activate__";
export const PAGE_ACTIVATE_REQUEST = "activate";
export const PAGE_ACTIVATE_RESPONSE = "activated";
export const PAGE_ACTIVATE_READY = "data-lasso-main-world-activate";
export const PAGE_ACTIVATE_TARGET = "data-lasso-activate-target";
