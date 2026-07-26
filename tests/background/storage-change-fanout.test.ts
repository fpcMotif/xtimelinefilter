import { describe, expect, it, vi } from "vitest";

import {
  createStorageChangeFanout,
  type StorageChangeFanoutDeps,
} from "@/background/storage-change-fanout";
import type { StorageChangedMessage } from "@/core/protocol";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function change(key: string, value: unknown): StorageChangedMessage {
  return {
    type: "lasso:storage-changed",
    area: "sync",
    key,
    oldValue: null,
    newValue: value,
  };
}

function harness(): {
  deps: StorageChangeFanoutDeps;
  runtimeSendMessage: ReturnType<typeof vi.fn>;
  queryTabs: ReturnType<typeof vi.fn>;
  tabSendMessage: ReturnType<typeof vi.fn>;
} {
  const runtimeSendMessage = vi.fn(async () => {});
  const queryTabs = vi.fn(async () => []);
  const tabSendMessage = vi.fn(async () => {});
  return {
    deps: {
      runtime: { sendMessage: runtimeSendMessage },
      tabs: { query: queryTabs, sendMessage: tabSendMessage },
    },
    runtimeSendMessage,
    queryTabs,
    tabSendMessage,
  };
}

describe("createStorageChangeFanout", () => {
  it("holds later changes for the same area and key until the first delivery finishes", async () => {
    const firstDelivery = deferred<void>();
    const h = harness();
    h.runtimeSendMessage.mockImplementationOnce(() => firstDelivery.promise);
    const fanout = createStorageChangeFanout(h.deps);
    const first = change("lasso:filter", 1);
    const second = change("lasso:filter", 2);

    fanout.publish(first);
    await vi.waitFor(() => expect(h.runtimeSendMessage).toHaveBeenCalledWith(first));
    fanout.publish(second);
    await flush();

    expect(h.runtimeSendMessage).toHaveBeenCalledTimes(1);
    firstDelivery.resolve();
    await vi.waitFor(() => expect(h.runtimeSendMessage).toHaveBeenCalledWith(second));
  });

  it("delivers different area-and-key lanes concurrently", async () => {
    const firstDelivery = deferred<void>();
    const h = harness();
    h.runtimeSendMessage.mockImplementationOnce(() => firstDelivery.promise);
    const fanout = createStorageChangeFanout(h.deps);
    const first = change("lasso:filter", 1);
    const other = change("lasso:settings", 2);

    fanout.publish(first);
    await vi.waitFor(() => expect(h.runtimeSendMessage).toHaveBeenCalledWith(first));
    fanout.publish(other);

    await vi.waitFor(() => expect(h.runtimeSendMessage).toHaveBeenCalledWith(other));
    firstDelivery.resolve();
  });

  it("absorbs runtime, query, and recipient failures before the next same-key change", async () => {
    const h = harness();
    h.runtimeSendMessage.mockRejectedValueOnce(new Error("receiver gone"));
    h.queryTabs.mockRejectedValueOnce(new Error("browser closing"));
    const fanout = createStorageChangeFanout(h.deps);
    const first = change("lasso:filter", 1);
    const second = change("lasso:filter", 2);

    fanout.publish(first);
    fanout.publish(second);

    await vi.waitFor(() => expect(h.runtimeSendMessage).toHaveBeenCalledWith(second));
    expect(h.queryTabs).toHaveBeenCalledTimes(2);
  });

  it("sends only valid top-frame tab recipients", async () => {
    const h = harness();
    h.queryTabs.mockResolvedValueOnce([
      { id: 7 },
      { id: undefined },
      {},
      { id: -1 },
      { id: 7.5 },
      { id: 8 },
    ]);
    h.tabSendMessage.mockRejectedValueOnce(new Error("tab closed"));
    const fanout = createStorageChangeFanout(h.deps);
    const message = change("lasso:filter", { enabled: true });

    fanout.publish(message);

    await vi.waitFor(() => expect(h.tabSendMessage).toHaveBeenCalledTimes(2));
    expect(h.tabSendMessage).toHaveBeenCalledWith(7, message, { frameId: 0 });
    expect(h.tabSendMessage).toHaveBeenCalledWith(8, message, { frameId: 0 });
  });

  it("does not let a rejected tab recipient poison its lane", async () => {
    const h = harness();
    h.queryTabs.mockResolvedValueOnce([{ id: 7 }]);
    h.tabSendMessage.mockRejectedValueOnce(new Error("tab closed"));
    const fanout = createStorageChangeFanout(h.deps);
    const first = change("lasso:filter", 1);
    const second = change("lasso:filter", 2);

    fanout.publish(first);
    fanout.publish(second);

    await vi.waitFor(() => expect(h.runtimeSendMessage).toHaveBeenCalledWith(second));
  });
});
