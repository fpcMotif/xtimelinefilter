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
    let installed: InstalledListener | undefined;
    let clicked: ClickedListener | undefined;
    const sendMessage = vi.fn(async () => {});
    globalThis.chrome = {
      ...(previousChrome as typeof chrome),
      runtime: {
        onInstalled: { addListener: vi.fn((cb: InstalledListener) => (installed = cb)) },
      },
      action: {
        onClicked: { addListener: vi.fn((cb: ClickedListener) => (clicked = cb)) },
      },
      tabs: { sendMessage },
    } as unknown as typeof chrome;

    await import("@/background/index");
    return {
      installed: installed as InstalledListener,
      clicked: clicked as ClickedListener,
      sendMessage,
    };
  }

  it("logs installation and ignores toolbar clicks without a tab id", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { installed, clicked, sendMessage } = await load();

    installed();
    clicked({});

    expect(debug).toHaveBeenCalledWith("[Lasso] installed");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("activates the clicked tab and swallows send failures", async () => {
    const { clicked, sendMessage } = await load();

    clicked({ id: 7 });
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith(7, { type: "lasso-activate" });

    sendMessage.mockRejectedValueOnce(new Error("tab closed"));
    clicked({ id: 8 });
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith(8, { type: "lasso-activate" });
  });
});
