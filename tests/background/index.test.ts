import { afterEach, describe, expect, it, vi } from "vitest";

type InstalledListener = () => void;
type ClickedListener = (tab: { id?: number }) => void;

describe("background service worker", () => {
  let previousChrome: unknown;

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    globalThis.chrome = previousChrome as typeof chrome;
  });

  async function load() {
    previousChrome = globalThis.chrome;
    let installed: ((details: { reason: string }) => void) | undefined;
    let messageListener: ((msg: unknown, sender: { tab?: { id?: number } }) => void) | undefined;
    const createTab = vi.fn();
    const setUninstallURL = vi.fn();
    const setBadgeText = vi.fn();
    const setBadgeBackgroundColor = vi.fn();

    globalThis.chrome = {
      ...(previousChrome as typeof chrome),
      runtime: {
        onInstalled: { addListener: vi.fn((cb: any) => (installed = cb)) },
        onMessage: { addListener: vi.fn((cb: any) => (messageListener = cb)) },
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
      installed: installed!,
      messageListener: messageListener!,
      createTab,
      setUninstallURL,
      setBadgeText,
      setBadgeBackgroundColor,
    };
  }

  it("logs installation and ignores toolbar clicks without a tab id", async () => {
    const { installed, messageListener, createTab, setUninstallURL, setBadgeText } = await load();

    installed({ reason: "install" });
    messageListener({ type: "lasso:badge", count: 1 }, {}); // no tab id

    expect(createTab).toHaveBeenCalled();
    expect(setUninstallURL).toHaveBeenCalled();
    expect(setBadgeText).not.toHaveBeenCalled();
  });

  it("activates the clicked tab and swallows send failures", async () => {
    const { messageListener, setBadgeText, setBadgeBackgroundColor } = await load();

    messageListener({ type: "lasso:badge", count: 7 }, { tab: { id: 7 } });
    await Promise.resolve();
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "7" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: "#1d9bf0" });

    messageListener({ type: "lasso:state", state: "asleep" }, { tab: { id: 8 } });
    await Promise.resolve();
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 8, text: "zz" });
  });
});
