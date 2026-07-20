import { render } from "preact";

import { createMirrorStatusStore } from "@/core/mirror-status";
import { sendToTab, type LassoStatusResponse } from "@/core/protocol";

import { PopupApp, type TabState } from "./PopupApp";

// oxlint-disable-next-line import/no-unassigned-import -- entrypoint stylesheet side effect.
import "@/ui/styles.css";

const mirrorStore = createMirrorStatusStore();

/** A popup action must not surface Chrome shutdown races to the user. */
function bestEffort(operation: () => Promise<unknown> | void): void {
  try {
    void Promise.resolve(operation()).catch(() => {});
  } catch {
    // Chrome can also throw synchronously while the extension reloads.
  }
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function queryState(): Promise<TabState> {
  try {
    const id = await activeTabId();
    if (id === undefined) return "off-x";
    const res = (await sendToTab(id, { type: "lasso:status" })) as LassoStatusResponse | undefined;
    if (!res) return "off-x";
    return res.awake ? "active" : "asleep";
  } catch {
    return "off-x"; // no content script in this tab
  }
}

async function wake(): Promise<boolean> {
  try {
    const id = await activeTabId();
    if (id === undefined) return false;
    const response = (await sendToTab(id, { type: "lasso-activate" })) as
      | LassoStatusResponse
      | undefined;
    return response?.awake === true;
  } catch (error) {
    console.error("[Lasso] Failed to wake tab:", error);
    return false;
  }
}

render(
  <PopupApp
    queryState={queryState}
    wake={wake}
    openOptions={() => {
      // The popup remains useful if Chrome is shutting down or this call races
      // an extension reload. Opening Options is a best-effort affordance.
      bestEffort(() => chrome.runtime.openOptionsPage());
    }}
    mirrorStatus={mirrorStore.read}
    subscribeMirrorStatus={mirrorStore.subscribe}
  />,
  document.getElementById("root") as HTMLElement,
);
