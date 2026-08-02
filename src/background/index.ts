import { createDataLifecycle } from "@/background/data-lifecycle";
import {
  decodeSettingsPatch,
  isClearDataRequest,
  isCoachRequest,
  isContentToBackgroundMessage,
  isFilterRequest,
  isGraphqlCatalogRequest,
  isListCacheRequest,
  isListUsageRequest,
  isMirrorStatusRequest,
  isSettingsRequest,
} from "@/core/protocol";
import { isCollectionsRequest } from "@/core/protocol/collections";
import { rawLocalArea, rawSyncArea } from "@/core/storage-areas";
import { isReactiveStorageKey } from "@/core/storage-keys";
import { buildConvexFolderReplica } from "@/packages/folders/replica-client";

// Minimal service worker (ADR-0002): no X tokens, no long-lived X state, no auth fetch.
import { badgePresentationFor, handleInstalled } from "./lifecycle";
import { canHandleMessage } from "./message-policy";
import { createMessageSenderClassifier } from "./message-sender";
import { createStorageChangeFanout } from "./storage-change-fanout";
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
const dataLifecycle = createDataLifecycle(rawLocalArea(), rawSyncArea(), undefined, {
  replica: buildConvexFolderReplica,
});
const classifySender = createMessageSenderClassifier(chrome.runtime);
const storageChangeFanout = createStorageChangeFanout({
  runtime: chrome.runtime,
  tabs: chrome.tabs,
});

// Chrome 106+ lets MV3 keep local/sync private from content scripts. Frontends
// use the validated storage protocol; the worker remains the sole owner.
const storageAccessReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.sync.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
]);
void storageAccessReady.catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" && area !== "sync") return;
  for (const [key, change] of Object.entries(changes)) {
    if (!isReactiveStorageKey(area, key)) continue;
    storageChangeFanout.publish({
      type: "lasso:storage-changed",
      area,
      key,
      // Chrome runtime messaging drops object fields whose value is undefined.
      // Keep this wire event complete; consumers already decode null as absent.
      oldValue: change.oldValue ?? null,
      newValue: change.newValue ?? null,
    });
  }
});

// Resume a failed legacy migration whenever MV3 wakes this worker. The persisted
// state makes repeats cheap and prevents a prior Privacy clear from migrating.
bestEffort(() => storageAccessReady.then(() => dataLifecycle.migrate()));

// Install moment (story beat 2): open the product itself as the tour and set the
// one-question exit form. (Replaces the old console.debug.)
chrome.runtime.onInstalled.addListener((details) => {
  bestEffort(() => storageAccessReady.then(() => dataLifecycle.migrate()));
  handleInstalled(details, {
    createTab: (url) => bestEffort(() => chrome.tabs.create({ url })),
    setUninstallURL: (url) => bestEffort(() => chrome.runtime.setUninstallURL(url)),
  });
});

// The toolbar badge mirrors each tab's live selection count ("7") or dormant
// state ("zz"); waking a dormant tab happens from the popup (story beat 9 —
// the popup replaces action.onClicked, which never fires once a popup is set).
chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (!canHandleMessage(classifySender(sender), msg)) return;
  if (isClearDataRequest(msg)) {
    void storageAccessReady
      .then(() => dataLifecycle.clear())
      .then(sendResponse, () => sendResponse({ localCleared: false, syncCleared: false }));
    return true;
  }
  if (isSettingsRequest(msg)) {
    void storageAccessReady
      .then(() =>
        msg.operation === "read"
          ? dataLifecycle.readSettings()
          : dataLifecycle.patchSettings(decodeSettingsPatch(msg.patch)),
      )
      .then(
        (settings) => sendResponse({ ok: true, settings }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Settings unavailable",
          }),
      );
    return true;
  }
  if (isFilterRequest(msg)) {
    void storageAccessReady
      .then(() =>
        msg.operation === "read"
          ? dataLifecycle.readFilter(msg.defaultLanguages)
          : dataLifecycle.commandFilter(msg.command, msg.defaultLanguages),
      )
      .then(
        (state) => sendResponse({ ok: true, state }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Filter unavailable",
          }),
      );
    return true;
  }
  if (isCoachRequest(msg)) {
    void storageAccessReady
      .then(() => dataLifecycle.runCoach(msg.command))
      .then(
        (result) => sendResponse({ ok: true, result }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Coach unavailable",
          }),
      );
    return true;
  }
  if (isListCacheRequest(msg)) {
    void storageAccessReady
      .then(() => dataLifecycle.listCache(msg))
      .then(
        (result) => sendResponse({ ok: true, ...result }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "List cache unavailable",
          }),
      );
    return true;
  }
  if (isListUsageRequest(msg)) {
    void storageAccessReady
      .then(() => dataLifecycle.listUsage(msg))
      .then(
        (result) => sendResponse({ ok: true, ...result }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "List usage unavailable",
          }),
      );
    return true;
  }
  if (isMirrorStatusRequest(msg)) {
    void storageAccessReady
      .then(() => dataLifecycle.mirrorStatus(msg))
      .then(
        (result) => sendResponse({ ok: true, ...result }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Mirror status unavailable",
          }),
      );
    return true;
  }
  if (isCollectionsRequest(msg)) {
    void storageAccessReady
      .then(() => dataLifecycle.collections(msg))
      .then(
        (result) => sendResponse({ ok: true, ...result }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "Folders unavailable",
          }),
      );
    return true;
  }
  if (isGraphqlCatalogRequest(msg)) {
    void storageAccessReady
      .then(() => dataLifecycle.graphqlCatalog(msg))
      .then(
        (result) => sendResponse({ ok: true, ...result }),
        (error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : "GraphQL catalog unavailable",
          }),
      );
    return true;
  }
  if (!isContentToBackgroundMessage(msg)) return;
  badgeWriter.publish(sender, badgePresentationFor(msg));
});

// A tab id spans documents. Commit, rather than `tabs.onUpdated("loading")`, is
// the boundary: redirected or aborted navigations leave the current badge intact.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && details.documentLifecycle === "active") {
    badgeWriter.clear(details.tabId);
  }
});

export const backgroundModule = true;
