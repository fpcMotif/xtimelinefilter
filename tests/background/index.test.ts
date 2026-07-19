import { afterEach, describe, expect, it, vi } from "vitest";

import { UNINSTALL_FORM_URL, WELCOME_URL } from "@/background/lifecycle";

type InstalledListener = (details: { reason: string }) => void;
type MessageSender = { tab?: { id?: number }; frameId?: number; documentId?: string };
type MessageListener = (msg: unknown, sender: MessageSender) => void;
type CommittedListener = (details: {
  tabId: number;
  frameId: number;
  documentLifecycle: "active" | "prerender" | "cached";
}) => void;

// index.ts wires install, message, and document-navigation events. The old
// action.onClicked wake path was removed once a popup was set; waking now happens
// from the popup. lifecycle.test.ts covers the pure functions; this covers Chrome.
describe("background service worker wiring", () => {
  let previousChrome: unknown;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    globalThis.chrome = previousChrome as typeof chrome;
  });

  async function load() {
    previousChrome = globalThis.chrome;
    let installed: InstalledListener | undefined;
    let message: MessageListener | undefined;
    let committed: CommittedListener | undefined;
    const createTab = vi.fn(async () => {});
    const setUninstallURL = vi.fn(async () => {});
    const setBadgeText = vi.fn(async () => {});
    const setBadgeBackgroundColor = vi.fn(async () => {});
    const getFrame = vi.fn(async () => ({ documentId: "doc-7" }));
    globalThis.chrome = {
      ...(previousChrome as typeof chrome),
      runtime: {
        onInstalled: { addListener: vi.fn((cb: InstalledListener) => (installed = cb)) },
        onMessage: { addListener: vi.fn((cb: MessageListener) => (message = cb)) },
        setUninstallURL,
      },
      tabs: {
        create: createTab,
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
    };
  }

  it("opens the welcome tab on install and ignores messages without a document identity", async () => {
    const { installed, message, createTab, setUninstallURL, setBadgeText } = await load();

    installed({ reason: "install" });
    expect(createTab).toHaveBeenCalledWith({ url: WELCOME_URL });
    expect(setUninstallURL).toHaveBeenCalledWith(UNINSTALL_FORM_URL);

    // A message without a document identity is ignored.
    message({ type: "lasso:badge", count: 3 }, { tab: { id: 7 }, frameId: 0 });
    expect(setBadgeText).not.toHaveBeenCalled();
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

    message({ type: "lasso:badge", count: 7 }, { tab: { id: 7 }, frameId: 0, documentId: "doc-7" });
    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "7" }));
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: "#1d9bf0" });

    // A non-badge message touches nothing.
    message({ type: "something-else" }, { tab: { id: 8 }, frameId: 0, documentId: "doc-8" });
    expect(setBadgeText).toHaveBeenCalledTimes(1);
  });

  it("does not let a previous document restore a committed tab's badge", async () => {
    const { message, setBadgeText, getFrame } = await load();
    getFrame.mockResolvedValueOnce({ documentId: "doc-new" });

    message(
      { type: "lasso:badge", count: 7 },
      { tab: { id: 7 }, frameId: 0, documentId: "doc-old" },
    );

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

    message({ type: "lasso:badge", count: 7 }, { tab: { id: 7 }, frameId: 0, documentId: "doc-7" });
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
    expect(() =>
      message(
        { type: "lasso:badge", count: 7 },
        { tab: { id: 7 }, frameId: 0, documentId: "doc-7" },
      ),
    ).not.toThrow();
  });

  it('sets the "zz" dormant badge with a neutral background', async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    message(
      { type: "lasso:state", state: "asleep" },
      { tab: { id: 7 }, frameId: 0, documentId: "doc-7" },
    );
    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "zz" }));
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: "#536471" });
  });

  it("clears the badge to empty on a zero count without recoloring", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    // count 0 → "" (falsy): badge cleared, no color applied.
    message({ type: "lasso:badge", count: 0 }, { tab: { id: 7 }, frameId: 0, documentId: "doc-7" });
    await vi.waitFor(() => expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "" }));
    expect(setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  it("ignores malformed and wrong-way messages without clearing the badge", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    const sender = { tab: { id: 7 }, frameId: 0, documentId: "doc-7" };
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
