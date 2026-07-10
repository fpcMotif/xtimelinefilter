import type { StorageLike } from "@/core/storage-areas";

/** In-memory StorageLike, optionally seeded; mirrors the chrome.storage areas. */
export function createMemoryArea(
  seed: Record<string, unknown> = {},
): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...seed };
  return {
    data,
    async get(keys?: string | string[] | null) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;

interface OnChangedFake {
  addListener(l: StorageChangeListener): void;
  removeListener?(l: StorageChangeListener): void;
}

function chromeStorage(): { onChanged: unknown } {
  return (globalThis as unknown as { chrome: { storage: { onChanged: unknown } } }).chrome.storage;
}

/**
 * Installs a fake chrome.storage.onChanged that auto-collects listeners, so a
 * test can `emit` a cross-context change and `restore` the previous mock.
 */
export function installOnChanged(): {
  emit: (key: string, newValue: unknown, area?: "sync" | "local") => void;
  restore: () => void;
} {
  const storage = chromeStorage();
  const prev = storage.onChanged;
  const listeners: StorageChangeListener[] = [];
  storage.onChanged = {
    addListener: (l: StorageChangeListener) => listeners.push(l),
    removeListener: () => {},
  } satisfies OnChangedFake;
  return {
    emit: (key, newValue, area = "sync") => {
      for (const l of listeners) l({ [key]: { newValue } }, area);
    },
    restore: () => {
      storage.onChanged = prev;
    },
  };
}

/** Swaps chrome.storage.onChanged for a caller-supplied fake (edge-case control), returning a restore fn. */
export function stubOnChanged(impl: Partial<OnChangedFake>): () => void {
  const storage = chromeStorage();
  const prev = storage.onChanged;
  storage.onChanged = impl;
  return () => {
    storage.onChanged = prev;
  };
}
