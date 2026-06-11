// Minimal service worker (ADR-0002): no tokens, no long-lived state, no auth fetch.
import { badgeTextFor, handleInstalled } from "./lifecycle";

// Install moment (story beat 2): open the product itself as the tour and set the
// one-question exit form. (Replaces the old console.debug.)
chrome.runtime.onInstalled.addListener((details) => {
  handleInstalled(details, {
    createTab: (url) => void chrome.tabs.create({ url }),
    setUninstallURL: (url) => void chrome.runtime.setUninstallURL(url),
  });
});

// The toolbar badge mirrors each tab's live selection count ("7") or dormant
// state ("zz"); waking a dormant tab happens from the popup (story beat 9 —
// the popup replaces action.onClicked, which never fires once a popup is set).
chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  const text = badgeTextFor(msg as Parameters<typeof badgeTextFor>[0]);
  if (text !== null) {
    void chrome.action.setBadgeText({ tabId, text });
    if (text && text !== "zz") {
      void chrome.action.setBadgeBackgroundColor({ tabId, color: "#1d9bf0" });
    }
  }
});
