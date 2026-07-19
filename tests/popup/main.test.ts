import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TabState } from "@/popup/PopupApp";

// Mock preact's render so we can capture the callbacks the entry hands to
// PopupApp (tab actions plus Mirror read/watch) and drive each branch
// directly — the entry's whole job is wiring those to chrome.tabs / chrome.runtime
// and the mirror-status store.
const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("preact", async () => {
  const actual = await vi.importActual<typeof import("preact")>("preact");
  return { ...actual, render };
});

const { mirrorStore } = vi.hoisted(() => ({
  mirrorStore: { publish: vi.fn(), read: vi.fn(), subscribe: vi.fn() },
}));
vi.mock("@/core/mirror-status", () => ({
  createMirrorStatusStore: () => mirrorStore,
}));

type PopupProps = {
  queryState(): Promise<TabState>;
  wake(): Promise<boolean>;
  openOptions(): void;
  mirrorStatus(): Promise<{ ok: boolean; at: number; configId: string } | null>;
  subscribeMirrorStatus(
    cb: (status: { ok: boolean; at: number; configId: string } | null) => void,
  ): () => void;
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
  mirrorStore.publish.mockClear();
  mirrorStore.read.mockClear();
  mirrorStore.subscribe.mockClear();
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

  it("reports 'off-x' when finding the active tab rejects", async () => {
    const { queryState } = await loadProps();
    query.mockRejectedValueOnce(new Error("tabs unavailable"));
    await expect(queryState()).resolves.toBe("off-x");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("reports 'off-x' when there is no active tab", async () => {
    const { queryState } = await loadProps();
    query.mockResolvedValueOnce([]);
    expect(await queryState()).toBe("off-x");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("wakes the active tab only after it confirms awake", async () => {
    const { wake } = await loadProps();
    sendMessage.mockResolvedValueOnce({ awake: true });
    await expect(wake()).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(1, { type: "lasso-activate" });
  });

  it("wake is a no-op with no active tab", async () => {
    const { wake } = await loadProps();
    query.mockResolvedValueOnce([]);
    await expect(wake()).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("wake reports false when the content script rejects", async () => {
    const { wake } = await loadProps();
    sendMessage.mockRejectedValueOnce(new Error("gone"));
    await expect(wake()).resolves.toBe(false);
  });

  it("wake reports false when finding the active tab rejects", async () => {
    const { wake } = await loadProps();
    query.mockRejectedValueOnce(new Error("tabs unavailable"));
    await expect(wake()).resolves.toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("openOptions opens the extension options page", async () => {
    const { openOptions } = await loadProps();
    openOptions();
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("absorbs an options-page rejection", async () => {
    const { openOptions } = await loadProps();
    openOptionsPage.mockRejectedValueOnce(new Error("extension reloaded"));
    openOptions();
    await Promise.resolve();
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("mirrorStatus is the mirror-status store's read, wired straight through", async () => {
    const { mirrorStatus } = await loadProps();
    mirrorStore.read.mockResolvedValueOnce({ ok: true, at: 7, configId: "mirror-1" });
    expect(await mirrorStatus()).toEqual({ ok: true, at: 7, configId: "mirror-1" });
    expect(mirrorStore.read).toHaveBeenCalledTimes(1);
  });

  it("subscribeMirrorStatus is the live mirror-status subscription", async () => {
    const { subscribeMirrorStatus } = await loadProps();
    const listener = vi.fn();
    const dispose = vi.fn();
    mirrorStore.subscribe.mockReturnValueOnce(dispose);

    expect(subscribeMirrorStatus(listener)).toBe(dispose);
    expect(mirrorStore.subscribe).toHaveBeenCalledWith(listener);
  });
});
