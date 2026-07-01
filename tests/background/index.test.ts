import { afterEach, describe, expect, it, vi } from "vitest";

type InstalledListener = (details: any) => void;
type MessageListener = (msg: unknown, sender: { tab?: { id?: number } }) => void;

describe("background service worker", () => {
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

    const setBadgeText = vi.fn();
    const setBadgeBackgroundColor = vi.fn();
    const createTab = vi.fn();
    const setUninstallURL = vi.fn();

    globalThis.chrome = {
      ...(previousChrome as typeof chrome),
      runtime: {
        onInstalled: { addListener: vi.fn((cb: InstalledListener) => (installed = cb)) },
        onMessage: { addListener: vi.fn((cb: MessageListener) => (message = cb)) },
        setUninstallURL,
      },
      action: {
        setBadgeText,
        setBadgeBackgroundColor,
      },
      tabs: { create: createTab },
    } as unknown as typeof chrome;

    await import("@/background/index");
    return {
      installed: installed as InstalledListener,
      message: message as MessageListener,
      setBadgeText,
      setBadgeBackgroundColor,
      createTab,
      setUninstallURL,
    };
  }

  it("handles installation by opening tour tab and setting uninstall URL", async () => {
    const { installed, createTab, setUninstallURL } = await load();

    installed({ reason: "install" });

    expect(createTab).toHaveBeenCalledWith({ url: expect.any(String) });
    expect(setUninstallURL).toHaveBeenCalledWith(expect.any(String));
  });

  it("handles toolbar badge updates on message", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    // No tab id -> ignored
    message({ type: "lasso:badge", count: 1 }, {});
    expect(setBadgeText).not.toHaveBeenCalled();

    // 0 selected -> dormant state, empty text
    message({ type: "lasso:badge", count: 0 }, { tab: { id: 7 } });
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "" });
    expect(setBadgeBackgroundColor).not.toHaveBeenCalled(); // Because text is ""

    // 1 selected -> shows badge
    message({ type: "lasso:badge", count: 1 }, { tab: { id: 8 } });
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: "1" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 8, color: "#1d9bf0" });

    // asleep state
    message({ type: "lasso:state", state: "asleep" }, { tab: { id: 9 } });
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 9, text: "zz" });
  });
});
