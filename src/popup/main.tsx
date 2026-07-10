import { render } from "preact";

import { type MirrorStatus, parseMirrorStatus } from "@/core/mirror-status";
import { STORAGE_KEYS } from "@/core/storage-keys";

import { PopupApp, type TabState } from "./PopupApp";

import "@/ui/styles.css";

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function queryState(): Promise<TabState> {
  const id = await activeTabId();
  if (id === undefined) return "off-x";
  try {
    const res = (await chrome.tabs.sendMessage(id, { type: "lasso:status" })) as
      | { awake?: boolean }
      | undefined;
    if (!res) return "off-x";
    return res.awake ? "active" : "asleep";
  } catch {
    return "off-x"; // no content script in this tab
  }
}

async function wake(): Promise<void> {
  const id = await activeTabId();
  if (id === undefined) return;
  await chrome.tabs.sendMessage(id, { type: "lasso-activate" }).catch(() => {});
}

async function mirrorStatus(): Promise<MirrorStatus | null> {
  try {
    const raw = await chrome.storage.local.get(STORAGE_KEYS.mirrorStatus);
    return parseMirrorStatus(raw[STORAGE_KEYS.mirrorStatus]);
  } catch {
    return null; // storage unavailable — no Mirror row
  }
}

render(
  <PopupApp
    queryState={queryState}
    wake={wake}
    openOptions={() => void chrome.runtime.openOptionsPage()}
    mirrorStatus={mirrorStatus}
  />,
  document.getElementById("root") as HTMLElement,
);
