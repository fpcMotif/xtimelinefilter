import { afterEach, describe, expect, it, vi } from "vitest";

import { UNINSTALL_FORM_URL, WELCOME_URL } from "@/background/lifecycle";

type InstalledListener = (details: { reason: string }) => void;
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
    const createTab = vi.fn();
    const setUninstallURL = vi.fn();
    const setBadgeText = vi.fn();
    const setBadgeBackgroundColor = vi.fn();
    globalThis.chrome = {
      ...(previousChrome as typeof chrome),
      runtime: {
        onInstalled: { addListener: vi.fn((cb: InstalledListener) => (installed = cb)) },
        onMessage: { addListener: vi.fn((cb: MessageListener) => (message = cb)) },
        setUninstallURL,
      },
      action: { setBadgeText, setBadgeBackgroundColor },
      tabs: { create: createTab },
    } as unknown as typeof chrome;

    await import("@/background/index");
    return {
      installed: installed as InstalledListener,
      message: message as MessageListener,
      createTab,
      setUninstallURL,
      setBadgeText,
      setBadgeBackgroundColor,
    };
  }

  it("opens the welcome tour on install and sets the uninstall form", async () => {
    const { installed, createTab, setUninstallURL } = await load();

    installed({ reason: "install" });

    expect(createTab).toHaveBeenCalledWith({ url: WELCOME_URL });
    expect(setUninstallURL).toHaveBeenCalledWith(UNINSTALL_FORM_URL);
  });

  it("mirrors the live selection count on the toolbar badge", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    message({ type: "lasso:badge", count: 7 }, { tab: { id: 3 } });

    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 3, text: "7" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 3, color: "#1d9bf0" });
  });

  it("marks dormant tabs zz without tinting the badge", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    message({ type: "lasso:state", state: "asleep" }, { tab: { id: 4 } });

    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 4, text: "zz" });
    expect(setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  it("ignores messages without a tab id or without badge content", async () => {
    const { message, setBadgeText } = await load();

    message({ type: "lasso:badge", count: 7 }, {});
    message({ type: "unrelated" }, { tab: { id: 5 } });

    expect(setBadgeText).not.toHaveBeenCalled();
  });
});
