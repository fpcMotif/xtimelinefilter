import { afterEach, describe, expect, it, vi } from "vitest";

import { UNINSTALL_FORM_URL, WELCOME_URL } from "@/background/lifecycle";

type InstalledListener = (details: { reason: string }) => void;
type MessageListener = (msg: unknown, sender: { tab?: { id?: number } }) => void;

// index.ts wires two chrome events: onInstalled → handleInstalled (open the
// welcome tour + set the uninstall form) and onMessage → mirror the content
// script's per-tab state onto the toolbar badge. (The old action.onClicked wake
// path was removed once a popup is set — see src/background/index.ts; waking now
// happens from the popup.) lifecycle.test.ts covers the pure functions; this
// covers the chrome wiring.
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
    const createTab = vi.fn(async () => {});
    const setUninstallURL = vi.fn(async () => {});
    const setBadgeText = vi.fn(async () => {});
    const setBadgeBackgroundColor = vi.fn(async () => {});
    globalThis.chrome = {
      ...(previousChrome as typeof chrome),
      runtime: {
        onInstalled: { addListener: vi.fn((cb: InstalledListener) => (installed = cb)) },
        onMessage: { addListener: vi.fn((cb: MessageListener) => (message = cb)) },
        setUninstallURL,
      },
      tabs: { create: createTab },
      action: { setBadgeText, setBadgeBackgroundColor },
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

  it("opens the welcome tab on install and ignores messages without a tab id", async () => {
    const { installed, message, createTab, setUninstallURL, setBadgeText } = await load();

    installed({ reason: "install" });
    expect(createTab).toHaveBeenCalledWith({ url: WELCOME_URL });
    expect(setUninstallURL).toHaveBeenCalledWith(UNINSTALL_FORM_URL);

    // A message whose sender has no tab id is ignored (no badge mutation).
    message({ type: "lasso:badge", count: 3 }, {});
    expect(setBadgeText).not.toHaveBeenCalled();
  });

  it("mirrors the selection count to the sending tab's badge", async () => {
    const { message, setBadgeText, setBadgeBackgroundColor } = await load();

    message({ type: "lasso:badge", count: 7 }, { tab: { id: 7 } });
    expect(setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: "7" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ tabId: 7, color: "#1d9bf0" });

    // A non-badge message (badgeTextFor → null) touches nothing.
    message({ type: "something-else" }, { tab: { id: 8 } });
    expect(setBadgeText).toHaveBeenCalledTimes(1);
  });
});
