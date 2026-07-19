/** Minimal storage surface we depend on — matches chrome.storage areas and our test mock. */
export interface StorageLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

/**
 * The platform seam: every chrome.storage reference in src/core + src/options
 * goes through one of these two factories, so a non-extension host only has to
 * replace this one module.
 */
export function syncArea(): StorageLike {
  return chrome.storage.sync as unknown as StorageLike;
}

export function localArea(): StorageLike {
  return chrome.storage.local as unknown as StorageLike;
}

export interface BlobStore<T> {
  /** The stored value, or `defaults` when nothing usable has been written yet. */
  get(): Promise<T>;
  /** Writes the value verbatim — callers merge patches over `get()` themselves — and returns it. */
  set(value: T): Promise<T>;
}

/** Binds one storage key to a typed get/set pair: the read-cast-fallback and write-wrap every blob store hand-rolled. */
export function blobStore<T>(area: StorageLike, key: string, defaults: T): BlobStore<T> {
  return {
    async get() {
      const raw = (await area.get(key))[key] as T | null | undefined;
      return raw == null ? defaults : raw;
    },
    async set(value: T) {
      await area.set({ [key]: value });
      return value;
    },
  };
}
