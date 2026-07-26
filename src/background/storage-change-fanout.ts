import type { StorageChangedMessage } from "@/core/protocol";

export interface StorageChangeFanoutDeps {
  runtime: {
    sendMessage(message: StorageChangedMessage): Promise<unknown>;
  };
  tabs: {
    query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
    sendMessage(
      tabId: number,
      message: StorageChangedMessage,
      options: { frameId: number },
    ): Promise<unknown>;
  };
}

export interface StorageChangeFanout {
  publish(change: StorageChangedMessage): void;
}

/**
 * Delivers storage transitions in order for each storage area/key pair.
 *
 * Chrome recipients are discovered for each event. The queues hold only the
 * in-flight promise, so neither tabs nor ports become retained worker state.
 */
export function createStorageChangeFanout(deps: StorageChangeFanoutDeps): StorageChangeFanout {
  const tails = new Map<string, Promise<void>>();

  function publish(change: StorageChangedMessage): void {
    const lane = `${change.area}\0${change.key}`;
    const previous = tails.get(lane) ?? Promise.resolve();
    const tail = previous.then(() => deliver(change));
    tails.set(lane, tail);
    void tail.finally(() => {
      if (tails.get(lane) === tail) tails.delete(lane);
    });
  }

  async function deliver(change: StorageChangedMessage): Promise<void> {
    await bestEffort(() => deps.runtime.sendMessage(change));
    const tabs = (await bestEffort(() => deps.tabs.query({}))) ?? [];
    await Promise.allSettled(
      tabs.flatMap((tab) => {
        const tabId = tab.id;
        return isTabId(tabId)
          ? [Promise.resolve().then(() => deps.tabs.sendMessage(tabId, change, { frameId: 0 }))]
          : [];
      }),
    );
  }

  return { publish };
}

function bestEffort<T>(operation: () => Promise<T>): Promise<T | undefined> {
  return Promise.resolve()
    .then(operation)
    .catch(() => undefined);
}

function isTabId(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
