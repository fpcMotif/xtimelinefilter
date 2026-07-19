import { isContentToBackgroundMessage } from "@/core/protocol";

// Minimal service worker (ADR-0002): no tokens, no long-lived state, no auth fetch.
import { badgePresentationFor, handleInstalled } from "./lifecycle";
import { TabBadgeWriter } from "./tab-badge-writer";

/** Chrome writes can fail while a tab or the browser is closing. */
function bestEffort(operation: () => Promise<unknown> | void): void {
  try {
    void Promise.resolve(operation()).catch(() => {});
  } catch {
    // Service-worker shutdown can also make Chrome throw synchronously.
  }
}

const badgeWriter = new TabBadgeWriter({
  async currentTopDocumentId(tabId) {
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    return frame?.documentId;
  },
  async write(tabId, presentation) {
    await chrome.action.setBadgeText({ tabId, text: presentation.text });
    if (presentation.backgroundColor) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: presentation.backgroundColor });
    }
  },
});

// Install moment (story beat 2): open the product itself as the tour and set the
// one-question exit form. (Replaces the old console.debug.)
chrome.runtime.onInstalled.addListener((details) => {
  handleInstalled(details, {
    createTab: (url) => bestEffort(() => chrome.tabs.create({ url })),
    setUninstallURL: (url) => bestEffort(() => chrome.runtime.setUninstallURL(url)),
  });
});

// The toolbar badge mirrors each tab's live selection count ("7") or dormant
// state ("zz"); waking a dormant tab happens from the popup (story beat 9 —
// the popup replaces action.onClicked, which never fires once a popup is set).
chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  if (!isContentToBackgroundMessage(msg)) return;
  const presentation = badgePresentationFor(msg);
  if (presentation) badgeWriter.publish(sender, presentation);
});

// A tab id spans documents. Commit, rather than `tabs.onUpdated("loading")`, is
// the boundary: redirected or aborted navigations leave the current badge intact.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && details.documentLifecycle === "active") {
    badgeWriter.clear(details.tabId);
  }
});

export const backgroundModule = true;
