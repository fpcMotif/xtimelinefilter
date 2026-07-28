import { afterEach, describe, expect, it, vi } from "vitest";

import { UNINSTALL_FORM_URL, WELCOME_URL } from "@/background/lifecycle";

type InstalledListener = (details: { reason: string }) => void;
type MessageSender = {
  id?: string;
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
  origin?: string;
  url?: string;
};
type SendResponse = (response: unknown) => void;
type MessageListener = (
  msg: unknown,
  sender: MessageSender,
  sendResponse?: SendResponse,
) => boolean | void;
type CommittedListener = (details: {
  tabId: number;
  frameId: number;
  documentLifecycle: "active" | "prerender" | "cached";
}) => void;
type StorageChangedListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string,
) => void;

// index.ts wires install, message, and document-navigation events. The old
// action.onClicked wake path was removed once a popup was set; waking now happens
// from the popup. lifecycle.test.ts covers the pure functions; this covers Chrome.
describe("background service worker wiring", () => {
  const extensionId = "lasso-id";
  const extensionUrl = (path: string): string =>
    `chrome-extension://${extensionId}/${path.replace(/^\//, "")}`;
  const optionsSender = (): MessageSender => ({
    id: extensionId,
    url: extensionUrl("src/options/index.html"),
  });
  const popupSender = (): MessageSender => ({
    id: extensionId,
    url: extensionUrl("src/popup/index.html"),
  });
  const contentSender = (overrides: Partial<MessageSender> = {}): MessageSender => ({
    id: extensionId,
    tab: { id: 7 },
    frameId: 0,
    documentId: "doc-7",
    origin: "https://x.com",
    url: "https://x.com/home",
    ...overrides,
  });
  let previousChrome: unknown;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    globalThis.chrome = previousChrome as typeof chrome;
  });

  async function load(accessFails = false) {
    previousChrome = globalThis.chrome;
    let installed: InstalledListener | undefined;
    let message: MessageListener | undefined;
    let committed: CommittedListener | undefined;
    let storageChanged: StorageChangedListener | undefined;
    const createTab = vi.fn(async () => {});
    const setUninstallURL = vi.fn(async () => {});
    const setBadgeText = vi.fn(async () => {});
    const setBadgeBackgroundColor = vi.fn(async () => {});
    const getFrame = vi.fn(async () => ({ documentId: "doc-7" }));
    const setLocalAccessLevel = vi.fn(async () => {
      if (accessFails) throw new Error("storage access lock failed");
    });
    const setSyncAccessLevel = vi.fn(async () => {});
    const runtimeSendMessage = vi.fn(async () => {});
    const queryTabs = vi.fn(async () => [{ id: 7 }, { id: undefined }]);
    const sendToTab = vi.fn(async () => {});
    const storage = (previousChrome as typeof chrome).storage;
    globalThis.chrome = {
      ...(previousChrome as typeof chrome),
      storage: {
        ...storage,
        local: { ...storage.local, setAccessLevel: setLocalAccessLevel },
        sync: { ...storage.sync, setAccessLevel: setSyncAccessLevel },
        onChanged: { addListener: vi.fn((cb: StorageChangedListener) => (storageChanged = cb)) },
      },
      runtime: {
        id: extensionId,
        getURL: extensionUrl,
        getManifest: () => ({
          options_ui: { page: "src/options/index.html" },
          action: { default_popup: "src/popup/index.html" },
        }),
        onInstalled: { addListener: vi.fn((cb: InstalledListener) => (installed = cb)) },
        onMessage: { addListener: vi.fn((cb: MessageListener) => (message = cb)) },
        setUninstallURL,
        sendMessage: runtimeSendMessage,
      },
      tabs: {
        create: createTab,
        query: queryTabs,
        sendMessage: sendToTab,
      },
      webNavigation: {
        getFrame,
        onCommitted: { addListener: vi.fn((cb: CommittedListener) => (committed = cb)) },
      },
      action: { setBadgeText, setBadgeBackgroundColor },
    } as unknown as typeof chrome;

    await import("@/background/index");
    return {
      installed: installed as InstalledListener,
      message: message as MessageListener,
      committed: committed as CommittedListener,
      createTab,
      setUninstallURL,
      setBadgeText,
      setBadgeBackgroundColor,
      getFrame,
      storageChanged: storageChanged as StorageChangedListener,
      setLocalAccessLevel,
      setSyncAccessLevel,
      runtimeSendMessage,
      queryTabs,
      sendToTab,
    };
  }

  it("opens the welcome tab on install and ignores messages without a document identity", async () => {
    const { installed, message, createTab, setUninstallURL, setBadgeText } = await load();

    installed({ reason: "install" });
    expect(createTab).toHaveBeenCalledWith({ url: WELCOME_URL });
    expect(setUninstallURL).toHaveBeenCalledWith(UNINSTALL_FORM_URL);

    // A message without a document identity is ignored.
    message({ type: "lasso:badge", count: 3 }, contentSender({ documentId: undefined }));
    expect(setBadgeText).not.toHaveBeenCalled();
  });

  it("locks both storage areas before serving storage authority", async () => {
    const { setLocalAccessLevel, setSyncAccessLevel } = await load();

    expect(setLocalAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
    expect(setSyncAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
  });

  it("fails storage authority closed when either access lock fails", async () => {
    const { message } = await load(true);
    const storage = vi.fn();
    const clear = vi.fn();

    message(
      {
        type: "lasso:filter",
        operation: "command",
        defaultLanguages: ["en"],
        command: { type: "cycle", id: "kind:video" },
      },
      contentSender(),
      storage,
    );
    message({ type: "lasso:clear-data" }, optionsSender(), clear);

    await vi.waitFor(() =>
      expect(storage).toHaveBeenCalledWith({ ok: false, error: "storage access lock failed" }),
    );
    await vi.waitFor(() =>
      expect(clear).toHaveBeenCalledWith({ localCleared: false, syncCleared: false }),
    );
  });

  it("fans out only managed storage transitions", async () => {
    const { storageChanged, runtimeSendMessage, queryTabs, sendToTab } = await load();
    const filter = { enabled: true };

    storageChanged({ "lasso:filter": { oldValue: undefined, newValue: filter } }, "sync");
    await vi.waitFor(() => expect(queryTabs).toHaveBeenCalledWith({}));
    const message = {
      type: "lasso:storage-changed",
      area: "sync",
      key: "lasso:filter",
      oldValue: null,
      newValue: filter,
    };
    expect(runtimeSendMessage).toHaveBeenCalledWith(message);
    expect(sendToTab).toHaveBeenCalledWith(7, message, { frameId: 0 });
  });

  it("fans out settings snapshots even though generic storage cannot read them", async () => {
    const { storageChanged, runtimeSendMessage } = await load();
    const settings = { backend: "graphql" };

    storageChanged({ "lasso:settings": { oldValue: undefined, newValue: settings } }, "local");

    await vi.waitFor(() =>
      expect(runtimeSendMessage).toHaveBeenCalledWith({
        type: "lasso:storage-changed",
        area: "local",
        key: "lasso:settings",
        oldValue: null,
        newValue: settings,
      }),
    );
  });

  it("preserves a prior storage value and encodes a deleted value as null", async () => {
    const { storageChanged, runtimeSendMessage } = await load();
    const prior = { backend: "rest" };

    storageChanged({ "lasso:settings": { oldValue: prior, newValue: undefined } }, "local");

    await vi.waitFor(() =>
      expect(runtimeSendMessage).toHaveBeenCalledWith({
        type: "lasso:storage-changed",
        area: "local",
        key: "lasso:settings",
        oldValue: prior,
        newValue: null,
      }),
    );
  });

  it("never broadcasts private or unknown storage changes", async () => {
    const { storageChanged, runtimeSendMessage, queryTabs, sendToTab } = await load();

    storageChanged({ "lasso:settings-migration": { newValue: "complete" } }, "local");
    storageChanged({ unknown: { newValue: true } }, "sync");
    storageChanged({ "lasso:filter": { newValue: true } }, "managed");
    await Promise.resolve();

    expect(runtimeSendMessage).not.toHaveBeenCalled();
    expect(queryTabs).not.toHaveBeenCalled();
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("rejects unknown storage keys without opening a storage operation", async () => {
    const { message } = await load();
    const sendResponse = vi.fn();

    expect(
      message(
        { type: "lasso:storage", area: "local", operation: "get", keys: "unknown" },
        optionsSender(),
        sendResponse,
      ),
    ).toBeUndefined();
    await Promise.resolve();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("rejects an invalid Filter command before it writes sync storage", async () => {
    const { message } = await load();
    const write = vi.spyOn(globalThis.chrome.storage.sync, "set");
    const sendResponse = vi.fn();

    expect(
      message(
        {
          type: "lasso:filter",
          operation: "command",
          defaultLanguages: ["en"],
          command: { type: "cycle", id: "unknown" },
        },
        contentSender(),
        sendResponse,
      ),
    ).toBeUndefined();
    await Promise.resolve();

    expect(sendResponse).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects generic settings/filter access but serves dedicated worker commands", async () => {
    const { message } = await load();
    const generic = vi.fn();
    const filterGeneric = vi.fn();
    const filter = vi.fn();
    const read = vi.fn();
    const patch = vi.fn();

    expect(
      message(
        { type: "lasso:storage", area: "local", operation: "get", keys: "lasso:settings" },
        optionsSender(),
        generic,
      ),
    ).toBeUndefined();
    expect(
      message(
        { type: "lasso:storage", area: "sync", operation: "get", keys: "lasso:filter" },
        contentSender(),
        filterGeneric,
      ),
    ).toBeUndefined();
    expect(
      message(
        {
          type: "lasso:filter",
          operation: "command",
          defaultLanguages: ["en"],
          command: { type: "cycle", id: "kind:video" },
        },
        contentSender(),
        filter,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(filter).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: true,
          state: expect.objectContaining({ criteria: { "kind:video": "only" } }),
        }),
      ),
    );
    expect(generic).not.toHaveBeenCalled();
    expect(filterGeneric).not.toHaveBeenCalled();
    expect(message({ type: "lasso:settings", operation: "read" }, optionsSender(), read)).toBe(
      true,
    );
    await vi.waitFor(() =>
      expect(read).toHaveBeenCalledWith(expect.objectContaining({ ok: true })),
    );

    expect(
      message(
        {
          type: "lasso:settings",
          operation: "patch",
          patch: { surfaces: { palette: true } },
        },
        optionsSender(),
        patch,
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(patch.mock.calls[0]?.[0]).toMatchObject({
        ok: true,
        settings: { surfaces: { palette: true } },
      }),
    );
    expect(generic).not.toHaveBeenCalled();
  });

  it("enforces sender capabilities before dispatch", async () => {
    const { message } = await load();
    const deniedClear = vi.fn();
    const deniedSettings = vi.fn();
    const allowedSettings = vi.fn();

    expect(message({ type: "lasso:clear-data" }, contentSender(), deniedClear)).toBeUndefined();
    expect(
      message(
        { type: "lasso:settings", operation: "patch", patch: { backend: "graphql" } },
        contentSender(),
        deniedSettings,
      ),
    ).toBeUndefined();
    expect(
      message(
        { type: "lasso:settings", operation: "patch", patch: { pillPosition: { x: 20 } } },
        contentSender(),
        allowedSettings,
      ),
    ).toBe(true);

    await vi.waitFor(() =>
      expect(allowedSettings).toHaveBeenCalledWith(expect.objectContaining({ ok: true })),
    );
    expect(deniedClear).not.toHaveBeenCalled();
    expect(deniedSettings).not.toHaveBeenCalled();
  });

  it("serves popup Filter and Settings reads, commits its Filter command, and denies Settings writes", async () => {
    const { message } = await load();
    const filterRead = vi.fn();
    const filterCommand = vi.fn();
    const settingsRead = vi.fn();
    const settingsPatch = vi.fn();

    expect(
      message(
        { type: "lasso:filter", operation: "read", defaultLanguages: ["en"] },
        popupSender(),
        filterRead,
      ),
    ).toBe(true);
    expect(
      message(
        {
          type: "lasso:filter",
          operation: "command",
          defaultLanguages: ["en"],
          command: { type: "set-enabled", on: false },
        },
        popupSender(),
        filterCommand,
      ),
    ).toBe(true);
    expect(
      message({ type: "lasso:settings", operation: "read" }, popupSender(), settingsRead),
    ).toBe(true);
    expect(
      message(
        { type: "lasso:settings", operation: "patch", patch: { highContrast: true } },
        popupSender(),
        settingsPatch,
      ),
    ).toBeUndefined();

    await vi.waitFor(() =>
      expect(filterCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, state: expect.objectContaining({ enabled: false }) }),
      ),
    );
    expect(filterRead).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(settingsRead).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(settingsPatch).not.toHaveBeenCalled();
  });

  it("serves each remaining storage facade route", async () => {
    const { message } = await load();
    const clear = vi.fn();
    const coach = vi.fn();
    const cache = vi.fn();
    const usage = vi.fn();
    const mirror = vi.fn();
    const graphql = vi.fn();
    const collections = vi.fn();

    expect(message({ type: "lasso:clear-data" }, optionsSender(), clear)).toBe(true);
    expect(
      message({ type: "lasso:coach", command: { kind: "mark-onboarded" } }, contentSender(), coach),
    ).toBe(true);
    expect(
      message(
        {
          type: "lasso:list-cache",
          operation: "begin",
          owner: { userId: "1", screenName: "one" },
        },
        contentSender(),
        cache,
      ),
    ).toBe(true);
    expect(
      message(
        { type: "lasso:list-usage", operation: "recent", ownerUserId: "1", limit: 1 },
        contentSender(),
        usage,
      ),
    ).toBe(true);
    expect(message({ type: "lasso:mirror-status", operation: "read" }, popupSender(), mirror)).toBe(
      true,
    );
    expect(
      message({ type: "lasso:graphql-catalog", operation: "begin" }, contentSender(), graphql),
    ).toBe(true);
    expect(
      message({ type: "lasso:collections", operation: "counts" }, optionsSender(), collections),
    ).toBe(true);

    await vi.waitFor(() =>
      expect(collections).toHaveBeenCalledWith({
        ok: true,
        counts: { folders: 0, savedPosts: 0 },
      }),
    );
    await vi.waitFor(() =>
      expect(clear).toHaveBeenCalledWith(expect.objectContaining({ localCleared: true })),
    );
    await vi.waitFor(() =>
      expect(coach).toHaveBeenCalledWith({ ok: true, result: { kind: "ok" } }),
    );
    await vi.waitFor(() =>
      expect(cache).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, token: expect.any(Object) }),
      ),
    );
    await vi.waitFor(() => expect(usage).toHaveBeenCalledWith({ ok: true, listIds: [] }));
    await vi.waitFor(() => expect(mirror).toHaveBeenCalledWith({ ok: true, status: null }));
    await vi.waitFor(() =>
      expect(graphql).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, token: expect.any(Object) }),
      ),
    );
  });

  it("maps every facade rejection to its public response", async () => {
    let coachAttempt = 0;
    let cacheAttempt = 0;
    let usageAttempt = 0;
    let mirrorAttempt = 0;
    let graphqlAttempt = 0;
    let collectionsAttempt = 0;
    vi.doMock("@/background/data-lifecycle", () => ({
      createDataLifecycle: () => ({
        migrate: async () => true,
        clear: async () => Promise.reject(new Error("clear failed")),
        readSettings: async () => Promise.reject(new Error("settings failed")),
        patchSettings: async () => Promise.reject("settings fallback"),
        readFilter: async () => Promise.reject("filter failed"),
        commandFilter: async () => Promise.reject(new Error("filter failed")),
        runCoach: async () =>
          Promise.reject(coachAttempt++ === 0 ? new Error("coach failed") : "coach fallback"),
        listCache: async () =>
          Promise.reject(cacheAttempt++ === 0 ? "cache failed" : new Error("cache failed")),
        listUsage: async () =>
          Promise.reject(usageAttempt++ === 0 ? new Error("usage failed") : "usage failed"),
        mirrorStatus: async () =>
          Promise.reject(mirrorAttempt++ === 0 ? "mirror failed" : new Error("mirror failed")),
        graphqlCatalog: async () =>
          Promise.reject(graphqlAttempt++ === 0 ? new Error("graphql failed") : "graphql failed"),
        collections: async () =>
          Promise.reject(
            collectionsAttempt++ === 0 ? new Error("folders failed") : "folders fallback",
          ),
      }),
    }));
    try {
      const { message } = await load();
      const clear = vi.fn();
      const settings = vi.fn();
      const filter = vi.fn();
      const coach = vi.fn();
      const cache = vi.fn();
      const usage = vi.fn();
      const mirror = vi.fn();
      const graphql = vi.fn();
      const collections = vi.fn();

      message({ type: "lasso:clear-data" }, optionsSender(), clear);
      message({ type: "lasso:settings", operation: "read" }, optionsSender(), settings);
      message(
        { type: "lasso:filter", operation: "read", defaultLanguages: ["en"] },
        popupSender(),
        filter,
      );
      message({ type: "lasso:coach", command: { kind: "mark-onboarded" } }, contentSender(), coach);
      message({ type: "lasso:list-cache", operation: "all" }, optionsSender(), cache);
      message(
        { type: "lasso:list-usage", operation: "recent", ownerUserId: "1", limit: 1 },
        contentSender(),
        usage,
      );
      message({ type: "lasso:mirror-status", operation: "read" }, popupSender(), mirror);
      message({ type: "lasso:graphql-catalog", operation: "begin" }, contentSender(), graphql);
      message({ type: "lasso:collections", operation: "counts" }, optionsSender(), collections);
      message({ type: "lasso:collections", operation: "counts" }, optionsSender(), collections);
      message(
        { type: "lasso:settings", operation: "patch", patch: { highContrast: true } },
        optionsSender(),
        settings,
      );
      message(
        {
          type: "lasso:filter",
          operation: "command",
          defaultLanguages: ["en"],
          command: { type: "set-enabled", on: false },
        },
        popupSender(),
        filter,
      );
      message({ type: "lasso:coach", command: { kind: "replay-intro" } }, optionsSender(), coach);
      message({ type: "lasso:list-cache", operation: "all" }, optionsSender(), cache);
      message(
        { type: "lasso:list-usage", operation: "record", ownerUserId: "1", listId: "1" },
        contentSender(),
        usage,
      );
      message({ type: "lasso:mirror-status", operation: "read" }, popupSender(), mirror);
      message({ type: "lasso:graphql-catalog", operation: "read" }, contentSender(), graphql);

      await vi.waitFor(() =>
        expect(clear).toHaveBeenCalledWith({ localCleared: false, syncCleared: false }),
      );
      await vi.waitFor(() =>
        expect(settings).toHaveBeenCalledWith({ ok: false, error: "settings failed" }),
      );
      await vi.waitFor(() =>
        expect(filter).toHaveBeenCalledWith({ ok: false, error: "Filter unavailable" }),
      );
      await vi.waitFor(() =>
        expect(coach).toHaveBeenCalledWith({ ok: false, error: "coach failed" }),
      );
      await vi.waitFor(() =>
        expect(cache).toHaveBeenCalledWith({ ok: false, error: "List cache unavailable" }),
      );
      await vi.waitFor(() =>
        expect(usage).toHaveBeenCalledWith({ ok: false, error: "usage failed" }),
      );
      await vi.waitFor(() =>
        expect(mirror).toHaveBeenCalledWith({ ok: false, error: "Mirror status unavailable" }),
      );
      await vi.waitFor(() =>
        expect(graphql).toHaveBeenCalledWith({ ok: false, error: "graphql failed" }),
      );
      await vi.waitFor(() =>
        expect(settings).toHaveBeenCalledWith({ ok: false, error: "Settings unavailable" }),
      );
      await vi.waitFor(() =>
        expect(filter).toHaveBeenCalledWith({ ok: false, error: "filter failed" }),
      );
      await vi.waitFor(() =>
        expect(coach).toHaveBeenCalledWith({ ok: false, error: "Coach unavailable" }),
      );
      await vi.waitFor(() =>
        expect(cache).toHaveBeenCalledWith({ ok: false, error: "cache failed" }),
      );
      await vi.waitFor(() =>
        expect(usage).toHaveBeenCalledWith({ ok: false, error: "List usage unavailable" }),
      );
      await vi.waitFor(() =>
        expect(mirror).toHaveBeenCalledWith({ ok: false, error: "mirror failed" }),
      );
      await vi.waitFor(() =>
        expect(graphql).toHaveBeenCalledWith({ ok: false, error: "GraphQL catalog unavailable" }),
      );
      await vi.waitFor(() =>
        expect(collections).toHaveBeenCalledWith({ ok: false, error: "folders failed" }),
      );
      await vi.waitFor(() =>
        expect(collections).toHaveBeenCalledWith({ ok: false, error: "Folders unavailable" }),
      );
    } finally {
      vi.doUnmock("@/background/data-lifecycle");
    }
  });

  it("absorbs rejected setup writes", async () => {
    const { installed, createTab, setUninstallURL } = await load();
    createTab.mockRejectedValueOnce(new Error("browser closing"));
    setUninstallURL.mockRejectedValueOnce(new Error("browser closing"));

    installed({ reason: "install" });
    await Promise.resolve();

    expect(createTab).toHaveBeenCalledWith({ url: WELCOME_URL });
    expect(setUninstallURL).toHaveBeenCalledWith(UNINSTALL_FORM_URL);
  });

  it("mirrors the selection count to the sending tab's badge", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    message({ type: "lasso:badge", count: 7 }, contentSender());
    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "7" }));
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: "#1d9bf0" });

    // A non-badge message touches nothing.
    message({ type: "something-else" }, contentSender({ tab: { id: 8 }, documentId: "doc-8" }));
    expect(setBadgeText).toHaveBeenCalledTimes(1);
  });

  it("does not let a previous document restore a committed tab's badge", async () => {
    const { message, setBadgeText, getFrame } = await load();
    getFrame.mockResolvedValueOnce({ documentId: "doc-new" });

    message({ type: "lasso:badge", count: 7 }, contentSender({ documentId: "doc-old" }));

    await vi.waitFor(() => expect(getFrame).toHaveBeenCalledWith({ tabId: 7, frameId: 0 }));
    expect(setBadgeText).not.toHaveBeenCalled();
  });

  it("clears stale badge state only when the top-level navigation commits", async () => {
    const { committed, setBadgeText } = await load();

    committed({ tabId: 7, frameId: 1, documentLifecycle: "active" });
    expect(setBadgeText).not.toHaveBeenCalled();

    committed({ tabId: 7, frameId: 0, documentLifecycle: "prerender" });
    expect(setBadgeText).not.toHaveBeenCalled();

    committed({ tabId: 7, frameId: 0, documentLifecycle: "active" });
    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "" }));
  });

  it("absorbs rejected badge writes", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();
    setBadgeBackgroundColor.mockRejectedValueOnce(new Error("tab closed"));

    message({ type: "lasso:badge", count: 7 }, contentSender());
    await Promise.resolve();

    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "7" }));
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: "#1d9bf0" });
  });

  it("absorbs synchronous Chrome write failures", async () => {
    const { installed, message, createTab, setBadgeText } = await load();
    createTab.mockImplementationOnce(() => {
      throw new Error("browser closing");
    });
    setBadgeText.mockImplementationOnce(() => {
      throw new Error("tab closed");
    });

    expect(() => installed({ reason: "install" })).not.toThrow();
    expect(() => message({ type: "lasso:badge", count: 7 }, contentSender())).not.toThrow();
  });

  it('sets the "zz" dormant badge with a neutral background', async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    message({ type: "lasso:state", state: "asleep" }, contentSender());
    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "zz" }));
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: "#536471" });
  });

  it("clears the badge to empty on a zero count without recoloring", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    // count 0 → "" (falsy): badge cleared, no color applied.
    message({ type: "lasso:badge", count: 0 }, contentSender());
    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "" }));
    expect(setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  it("ignores malformed and wrong-way messages without clearing the badge", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    const sender = contentSender();
    message({ type: "lasso:badge", count: 4 }, sender);
    message({ type: "lasso:badge", count: -1 }, sender);
    message({ type: "lasso:badge", count: 1.5 }, sender);
    message({ type: "lasso:status" }, sender);
    message({ type: "lasso-activate" }, sender);

    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledTimes(1));
    expect(setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: "4" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledTimes(1);
  });
});
