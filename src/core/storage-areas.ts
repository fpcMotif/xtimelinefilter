/** Minimal storage surface we depend on — matches chrome.storage areas and our test mock. */
export interface StorageLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

/** Raw chrome.storage access for the background owner, tests, and non-extension fallback. */
export function rawSyncArea(): StorageLike {
  return chrome.storage.sync as unknown as StorageLike;
}

/** Raw chrome.storage access for the background owner, tests, and non-extension fallback. */
export function rawLocalArea(): StorageLike {
  return chrome.storage.local as unknown as StorageLike;
}

export function syncArea(): StorageLike {
  return rawSyncArea();
}

export function localArea(): StorageLike {
  return rawLocalArea();
}
