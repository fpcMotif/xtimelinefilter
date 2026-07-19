import type { StorageLike } from "@/core/storage-areas";
import { watchStorageKey } from "@/core/storage-sync";

/**
 * The deep module owning cross-context reactive coherence for one storage key
 * (sync by default; `areaName` names the area the injected `area` fronts): an
 * in-memory cache, merge-over-defaults, transition-aware event handling, and the raw
 * chrome.storage listener (via storage-sync.ts). Each store layers its own
 * reactive face on top — syncedStore knows nothing of signals, domain mutators,
 * or transient state. Option-free by design: four methods, zero bridging hooks.
 */
export interface SyncedStore<T> {
  /** The latest optimistic or confirmed value. */
  current(): T;
  /** Read storage once and merge over defaults; idempotent (later calls are no-ops). */
  hydrate(): Promise<void>;
  /**
   * Update the cache synchronously, then write to storage in invocation order
   * (STRICT — may reject). A rejection restores confirmed authority, never an
   * older optimistic snapshot.
   */
  /**
   * Resolves to the authority when this ordered write settles. When supplied,
   * `expectedAuthority` cancels the persistence if newer authority won first.
   */
  write(next: T, expectedAuthority?: T): Promise<T>;
  /** Watch another context's accepted transition. The idempotent disposer stops it. */
  onExternalChange(cb: (next: T, previous: T) => void): () => void;
}

/** A non-null, non-array object — the only values {@link syncedStore} merges one level deep. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function serialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

interface PendingWrite<T> {
  next: T;
  /** Set only when this invocation reaches the ordered persistence queue. */
  persistenceEpoch: number | undefined;
  /** A different storage event became authority after this invocation started. */
  supersededByExternalEvent: boolean;
}

export function syncedStore<T extends object>(
  key: string,
  defaults: T,
  area: StorageLike,
  areaName: "sync" | "local" = "sync",
): SyncedStore<T> {
  let confirmed: T = defaults;
  let cache: T = confirmed;
  const pendingWrites: PendingWrite<T>[] = [];
  const subscribers = new Set<(next: T, previous: T) => void>();
  let writes: Promise<void> | undefined;
  let hydrated = false;
  let hydratePromise: Promise<void> | undefined;
  let stopExternalWatch: (() => void) | undefined;
  let authorityKnown = false;
  // Advances only for storage events. A local write may confirm only when this
  // remains unchanged from the instant its ordered set() begins.
  let externalEpoch = 0;
  // A read begun before a confirmed write or storage event cannot replace it.
  // Optimistic writes deliberately do not advance this: a failed write must not
  // discard a persisted value that an already-running hydrate will return.
  let confirmedRevision = 0;

  const merge = (raw: unknown): T => {
    const stored = (isPlainObject(raw) ? raw : {}) as Partial<T>;
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

  const samePayload = (a: T, b: T): boolean => {
    if (a === b) return true;
    const left = serialize(a);
    return left !== undefined && left === serialize(b);
  };
  const setConfirmed = (next: T): boolean => {
    const changed = !samePayload(confirmed, next);
    confirmed = next;
    confirmedRevision += 1;
    authorityKnown = true;
    return changed;
  };
  const updateCache = (): boolean => {
    let optimistic: PendingWrite<T> | undefined;
    for (let index = pendingWrites.length - 1; index >= 0; index -= 1) {
      const write = pendingWrites[index]!;
      if (!write.supersededByExternalEvent) {
        optimistic = write;
        break;
      }
    }
    const next = optimistic?.next ?? confirmed;
    const changed = !samePayload(cache, next);
    cache = next;
    return changed;
  };
  const retire = (write: PendingWrite<T>): void => {
    const index = pendingWrites.indexOf(write);
    pendingWrites.splice(index, 1);
  };
  const notify = (previous: T): void => {
    for (const subscriber of subscribers) subscriber(cache, previous);
  };
  const transitionIsCurrent = (previous: T): boolean => {
    if (!authorityKnown || samePayload(previous, confirmed)) return true;
    // A set() may update storage before its promise resolves. A later external
    // transition can therefore start from that in-flight value, not `confirmed`.
    return pendingWrites.some(
      (write) => write.persistenceEpoch !== undefined && samePayload(previous, write.next),
    );
  };
  const handleStorageChange = (rawOld: unknown, rawNew: unknown): void => {
    const previous = merge(rawOld);
    const next = merge(rawNew);
    if (!transitionIsCurrent(previous)) return; // delayed echo from superseded authority
    // An echo that lands after local success confirms no new authority. It must
    // not displace a later optimistic write still waiting for its own set().
    if (authorityKnown && samePayload(next, confirmed)) return;

    externalEpoch += 1;
    const matchingWrite = pendingWrites.find((write) => samePayload(write.next, next));
    setConfirmed(next);
    if (!matchingWrite) {
      // A distinct external value supersedes every local attempt already queued.
      // A queued write becomes optimistic again only when its own set() starts.
      for (const write of pendingWrites) write.supersededByExternalEvent = true;
    }
    if (updateCache()) notify(previous);
  };

  const watchExternalTransitions = (cb: (next: T, previous: T) => void): (() => void) => {
    let active = true;
    subscribers.add(cb);
    stopExternalWatch ??= watchStorageKey(areaName, key, ({ oldValue, newValue }) =>
      handleStorageChange(oldValue, newValue),
    );
    return () => {
      if (!active) return;
      active = false;
      subscribers.delete(cb);
      if (subscribers.size === 0) {
        stopExternalWatch?.();
        stopExternalWatch = undefined;
      }
    };
  };

  return {
    current: () => cache,

    hydrate() {
      if (hydrated) return Promise.resolve();
      if (hydratePromise) return hydratePromise;

      const startedAt = confirmedRevision;
      let read: Promise<Record<string, unknown>>;
      try {
        read = Promise.resolve(area.get(key));
      } catch (error) {
        read = Promise.reject(error);
      }
      const pending = read
        .then((items) => {
          // Confirmed writes and storage events outrank this stale read. A local
          // optimistic write does not: if it later rejects, this read is still
          // the best persisted authority.
          if (confirmedRevision === startedAt) {
            setConfirmed(merge(items[key]));
            updateCache();
          }
          hydrated = true;
        })
        .finally(() => {
          hydratePromise = undefined;
        });
      hydratePromise = pending;
      return pending;
    },

    write(next: T, expectedAuthority?: T) {
      const write: PendingWrite<T> = {
        next,
        persistenceEpoch: undefined,
        supersededByExternalEvent: false,
      };
      pendingWrites.push(write);
      updateCache(); // synchronous optimistic current()

      // chrome.storage writes are last-write-wins. Serializing calls gives local
      // callers deterministic invocation order without adding domain policy.
      const persist = (): Promise<void> => {
        if (expectedAuthority !== undefined && !samePayload(confirmed, expectedAuthority)) {
          return Promise.resolve();
        }
        write.persistenceEpoch = externalEpoch;
        write.supersededByExternalEvent = false;
        updateCache();
        try {
          return Promise.resolve(area.set({ [key]: next }));
        } catch (error) {
          return Promise.reject(error);
        }
      };
      const attempt = writes ? writes.then(persist) : persist();
      writes = attempt.catch(() => {});
      return attempt.then(
        () => {
          retire(write);
          const authority = write.persistenceEpoch === externalEpoch ? next : confirmed;
          if (write.persistenceEpoch === externalEpoch) setConfirmed(next);
          updateCache();
          return authority;
        },
        (error: unknown) => {
          retire(write);
          // Recompute from confirmed authority plus still-valid optimistic work.
          // Never restore a snapshot captured before this invocation.
          updateCache();
          throw error;
        },
      );
    },

    onExternalChange: watchExternalTransitions,
  };
}
