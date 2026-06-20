import type { StorageLike } from "@/core/settings";
import { watchStorageKey } from "@/core/storage-sync";

/**
 * The deep module owning cross-context reactive coherence for one storage.sync
 * key: an in-memory cache, merge-over-defaults, echo-suppression, and the raw
 * chrome.storage listener (via storage-sync.ts). Each store layers its own
 * reactive face on top — syncedStore knows nothing of signals, domain mutators,
 * or transient state. Option-free by design: four methods, zero bridging hooks.
 */
export interface SyncedStore<T> {
  /** The cached latest merged value, kept fresh by the cross-context listener. */
  current(): T;
  /** Read storage once and merge over defaults; idempotent (later calls are no-ops). */
  hydrate(): Promise<void>;
  /** Update the cache + stamp the echo synchronously, then write to storage (STRICT — may reject). */
  write(next: T): Promise<void>;
  /** Adopt another context's write: merge over defaults, drop our own echo, update cache, fire cb. */
  onExternalChange(cb: (next: T) => void): void;
}

export function syncedStore<T extends object>(
  key: string,
  defaults: T,
  area: StorageLike,
): SyncedStore<T> {
  let cache: T = defaults;
  // The serialized value we last wrote/adopted — lets the listener drop the echo
  // of our own write. null until the first write/adopt, so the first external
  // change is always taken (matches the settings face's prior lastNotified=null).
  let lastEcho: string | null = null;
  let hydrated = false;

  const merge = (raw: unknown): T => ({ ...defaults, ...(raw as Partial<T> | undefined) });

  return {
    current: () => cache,

    async hydrate() {
      if (hydrated) return;
      cache = merge((await area.get(key))[key]);
      hydrated = true;
    },

    async write(next: T) {
      cache = next;
      lastEcho = JSON.stringify(next);
      await area.set({ [key]: next });
    },

    onExternalChange(cb) {
      watchStorageKey("sync", key, (raw) => {
        const next = merge(raw);
        const serialized = JSON.stringify(next);
        if (serialized === lastEcho) return; // our own write echoing back
        lastEcho = serialized;
        cache = next;
        cb(next);
      });
    },
  };
}
