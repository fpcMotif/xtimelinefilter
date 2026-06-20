import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TabState } from "@/popup/PopupApp";

// Mock preact's render so we can capture the three callbacks the entry hands to
// PopupApp (queryState / wake / openOptions) and drive each branch directly —
// the entry's whole job is wiring those to chrome.tabs / chrome.runtime.
const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("preact", async () => {
  const actual = await vi.importActual<typeof import("preact")>("preact");
  return { ...actual, render };
});

type PopupProps = {
  queryState(): Promise<TabState>;
  wake(): Promise<void>;
  openOptions(): void;
};

let query: ReturnType<typeof vi.fn>;
let sendMessage: ReturnType<typeof vi.fn>;
let openOptionsPage: ReturnType<typeof vi.fn>;
let previousChrome: unknown;

async function loadProps(): Promise<PopupProps> {
  document.body.innerHTML = '<div id="root"></div>';
  render.mockClear();
  vi.resetModules();
  await import("@/popup/main");
  const [vnode] = render.mock.calls[0] as [{ props: PopupProps }];
  return vnode.props;
}

beforeEach(() => {
  previousChrome = globalThis.chrome;
  query = vi.fn(async () => [{ id: 1 }]);
  sendMessage = vi.fn(async () => ({ awake: true }));
  openOptionsPage = vi.fn();
  globalThis.chrome = {
    ...(previousChrome as typeof chrome),
    tabs: { query, sendMessage },
    runtime: { openOptionsPage },
  } as unknown as typeof chrome;
});

afterEach(() => {
  globalThis.chrome = previousChrome as typeof chrome;
  vi.restoreAllMocks();
});

describe("popup entry", () => {
  it("reports 'active' when the content script answers awake", async () => {
    const { queryState } = await loadProps();
    sendMessage.mockResolvedValueOnce({ awake: true });
    expect(await queryState()).toBe("active");
    expect(sendMessage).toHaveBeenCalledWith(1, { type: "lasso:status" });
  });

  it("reports 'asleep' when the content script answers not-awake", async () => {
    const { queryState } = await loadProps();
    sendMessage.mockResolvedValueOnce({ awake: false });
    expect(await queryState()).toBe("asleep");
  });

  it("reports 'off-x' when the content script returns nothing", async () => {
    const { queryState } = await loadProps();
    sendMessage.mockResolvedValueOnce(undefined);
    expect(await queryState()).toBe("off-x");
  });

  it("reports 'off-x' when no content script answers (sendMessage rejects)", async () => {
    const { queryState } = await loadProps();
    sendMessage.mockRejectedValueOnce(new Error("no receiver"));
    expect(await queryState()).toBe("off-x");
  });

  it("reports 'off-x' when there is no active tab", async () => {
    const { queryState } = await loadProps();
    query.mockResolvedValueOnce([]);
    expect(await queryState()).toBe("off-x");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("wakes the active tab", async () => {
    const { wake } = await loadProps();
    sendMessage.mockResolvedValueOnce(undefined);
    await wake();
    expect(sendMessage).toHaveBeenCalledWith(1, { type: "lasso-activate" });
  });

  it("wake is a no-op with no active tab", async () => {
    const { wake } = await loadProps();
    query.mockResolvedValueOnce([]);
    await wake();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("wake swallows a sendMessage rejection", async () => {
    const { wake } = await loadProps();
    sendMessage.mockRejectedValueOnce(new Error("gone"));
    await expect(wake()).resolves.toBeUndefined();
  });

  it("openOptions opens the extension options page", async () => {
    const { openOptions } = await loadProps();
    openOptions();
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
