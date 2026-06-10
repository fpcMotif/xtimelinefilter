// Shared test setup. Provides a minimal in-memory chrome.storage mock so units that
// touch chrome.storage.local can run under happy-dom without the extension runtime.
import { beforeEach, vi } from "vitest";

type Store = Record<string, unknown>;

function createStorageArea() {
  let data: Store = {};
  return {
    async get(keys?: string | string[] | null): Promise<Store> {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items: Store): Promise<void> {
      data = { ...data, ...items };
    },
    async remove(keys: string | string[]): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    },
    async clear(): Promise<void> {
      data = {};
    },
    __reset(): void {
      data = {};
    },
  };
}

const local = createStorageArea();
const sync = createStorageArea();

// @ts-expect-error — minimal shim, not the full chrome typings surface.
globalThis.chrome = { storage: { local, sync } };

beforeEach(() => {
  local.__reset();
  sync.__reset();
  vi.restoreAllMocks();
});
