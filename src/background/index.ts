// Minimal service worker (ADR-0002): no tokens, no long-lived state, no auth fetch.
chrome.runtime.onInstalled.addListener(() => {
  console.debug("[Lasso] installed");
});

// On-demand activation (ADR-0006): clicking the toolbar icon wakes the content
// script's UI on that tab. Only relevant when activation = "on-demand".
chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    chrome.tabs.sendMessage(tab.id, { type: "lasso-activate" }).catch(() => {});
  }
});

export const backgroundModule = true;
