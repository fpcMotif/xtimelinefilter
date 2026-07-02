import type { StorageLike } from "@/core/settings";
import { watchStorageKey } from "@/core/storage-sync";

/**
 * The deep module owning cross-context reactive coherence for one storage key
 * (sync by default; `areaName` names the area the injected `area` fronts): an
 * in-memory cache, merge-over-defaults, echo-suppression, and the raw
 * chrome.storage listener (via storage-sync.ts). Each store layers its own
 * reactive face on top — syncedStore knows nothing of signals, domain mutators,
 * or transient state. Option-free by design: four methods, zero bridging hooks.
 */
export interface SyncedStore<T> {
  /** The cached latest merged value, kept fresh by the cross-context listener. */
  current(): T;
  /** Read storage once and merge over defaults; idempotent (later calls are no-ops). */
  hydrate(): Promise<void>;
  /**
   * Update the cache + stamp the echo synchronously, then write to storage
   * (STRICT — may reject). On rejection the cache rolls back and the echo is
   * retired, so a failed write never reads back as success.
   */
  write(next: T): Promise<void>;
  /** Adopt another context's write: merge over defaults, drop our own echo, update cache, fire cb. */
  onExternalChange(cb: (next: T) => void): void;
}

/** A non-null, non-array object — the only values {@link syncedStore} merges one level deep. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function syncedStore<T extends object>(
  key: string,
  defaults: T,
  area: StorageLike,
  areaName: "sync" | "local" = "sync",
): SyncedStore<T> {
  let cache: T = defaults;
  // Serializations of our own writes not yet seen echo back, so the cross-context
  // listener can drop each one. A Set, not a single slot: under two rapid
  // same-context writes the earlier echo would otherwise no longer match a single
  // slot, get adopted as an "external" change, and flicker the cache back before
  // reconverging. Drained as each echo arrives — in production
  // chrome.storage.onChanged always fires for our own writes, so it stays bounded;
  // listener-less contexts (unit/e2e/plain web) are short-lived.
  const pendingEchoes = new Set<string>();
  let hydrated = false;

  const merge = (raw: unknown): T => {
    const stored = (raw ?? {}) as Partial<T>;
    const out = { ...defaults, ...stored };
    // Backfill nested object defaults one level deep: a shallow spread lets a
    // stored nested object replace the whole default, silently dropping any key
    // added to the default in a later version (a migration foot-gun).
    // Arrays and non-objects are still replaced wholesale.
    for (const k of Object.keys(defaults) as (keyof T)[]) {
      if (isPlainObject(defaults[k])) {
        const sv = stored[k];
        out[k] = (isPlainObject(sv) ? { ...defaults[k], ...sv } : defaults[k]) as T[keyof T];
      }
    }
    return out;
  };

  return {
    current: () => cache,

    async hydrate() {
      if (hydrated) return;
      cache = merge((await area.get(key))[key]);
      hydrated = true;
    },

    async write(next: T) {
      const prev = cache;
      const echo = JSON.stringify(next);
      cache = next;
      pendingEchoes.add(echo);
      try {
        await area.set({ [key]: next });
      } catch (err) {
        // A rejected write must not read back as success: restore the cache
        // (unless a newer write already superseded it — last-wins) and retire
        // the echo that will now never arrive. If overlapping writes BOTH fail,
        // the cache keeps the newest attempt — no worse than the pre-rollback
        // behavior, and the next external change or hydrate reconverges it.
        if (cache === next) cache = prev;
        pendingEchoes.delete(echo);
        throw err;
      }
    },

    onExternalChange(cb) {
      watchStorageKey(areaName, key, (raw) => {
        const next = merge(raw);
        const serialized = JSON.stringify(next);
        if (pendingEchoes.delete(serialized)) return; // one of our own writes echoing back
        cache = next;
        cb(next);
      });
    },
  };
}
