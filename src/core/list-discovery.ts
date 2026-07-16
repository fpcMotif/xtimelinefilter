import type { StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";
import { fetchMembershipListIds, fetchOwnedLists } from "@/core/x-client/lists-provider";
import { type Credentials, XApiError, type XList } from "@/core/x-client/types";

const KEY = STORAGE_KEYS.lists;

/**
 * Failure kinds discovery exposes to callers — only the product-relevant ones.
 * Transport specifics (HTTP status, endpoint, parse errors) stay inside the module;
 * a caller can react to these three without string-matching or knowing REST exists.
 */
export type ListDiscoveryErrorKind = "auth" | "rate-limited" | "unknown";

/** Thrown by {@link ListDiscovery.ownedLists}/{@link ListDiscovery.refresh} only when
 * there is nothing to show at all (no usable cache). */
export class ListDiscoveryError extends Error {
  readonly kind: ListDiscoveryErrorKind;
  /** Epoch seconds from x-rate-limit-reset, when X provided one (kind "rate-limited"). */
  readonly resetAt?: number;
  constructor(kind: ListDiscoveryErrorKind, message: string, opts: { resetAt?: number } = {}) {
    super(message);
    this.name = "ListDiscoveryError";
    this.kind = kind;
    this.resetAt = opts.resetAt;
  }
}

/**
 * The seam the Picker and Controller depend on for the user's OWN Lists.
 *
 * Discovery is *strategy-independent*: it always loads through the stable v1.1 REST
 * ownerships endpoint regardless of which mutation Backend (DOM/REST/GraphQL) is
 * active (ADR-0008). This interface hides fetch, auth, parsing, caching, and the
 * cache-first + silent-refresh dance so no caller reassembles them.
 */
export interface ListDiscovery {
  /**
   * Owned Lists for display, cache-first. When `onRefresh` is supplied, a fresh copy
   * is loaded in the background and delivered exactly once (silent refresh); a failed
   * or empty refresh is dropped so it can never blank a populated picker. Throws
   * {@link ListDiscoveryError} only when the cache is cold *and* the load fails.
   */
  ownedLists(opts?: { onRefresh?: (lists: XList[]) => void }): Promise<XList[]>;
  /** Force a fresh load (picker retry), updating the cache. Throws {@link ListDiscoveryError}. */
  refresh(): Promise<XList[]>;
  /**
   * Best-effort ids of owned Lists already containing `screenName` — the picker's
   * "already in" checks. Never throws: any failure resolves to [] so a flaky lookup
   * cannot block the picker.
   */
  membership(screenName: string): Promise<string[]>;
}

export interface ListDiscoveryDeps {
  fetch: typeof fetch;
  /** Read lazily per call — ct0 may be unreadable at startup / when logged out. */
  creds: () => Credentials;
  /** Owned-List cache; defaults to chrome.storage.local. */
  storage?: StorageLike;
}

/** Narrows any transport failure down to discovery's three product-relevant kinds. */
function toDiscoveryError(e: unknown): ListDiscoveryError {
  if (e instanceof XApiError) {
    if (e.kind === "auth") return new ListDiscoveryError("auth", e.message);
    if (e.kind === "rate-limited") {
      return new ListDiscoveryError("rate-limited", e.message, { resetAt: e.resetAt });
    }
  }
  return new ListDiscoveryError("unknown", e instanceof Error ? e.message : String(e));
}

/**
 * The one place that knows how the user's owned Lists are loaded, cached, and
 * refreshed. Composes the v1.1 transport (lists-provider) with local caching so the
 * Picker and Controller depend on Lists, not on fetch/auth/cache mechanics.
 */
export function createListDiscovery(deps: ListDiscoveryDeps): ListDiscovery {
  const storage = deps.storage ?? (chrome.storage.local as unknown as StorageLike);

  async function readCache(): Promise<XList[] | undefined> {
    return (await storage.get(KEY))[KEY] as XList[] | undefined;
  }

  /** Loads from X, updates the cache, and narrows any failure. */
  async function loadFresh(): Promise<XList[]> {
    let fresh: XList[];
    try {
      fresh = await fetchOwnedLists({ fetch: deps.fetch, creds: deps.creds() });
    } catch (e) {
      throw toDiscoveryError(e);
    }
    await storage.set({ [KEY]: fresh });
    return fresh;
  }

  return {
    async ownedLists({ onRefresh } = {}) {
      const cached = await readCache();
      if (cached?.length) {
        // Cache-first: show now, then silently reconcile with X in the background.
        if (onRefresh) {
          void loadFresh()
            .then((fresh) => {
              if (fresh.length > 0) onRefresh(fresh);
            })
            .catch(() => {}); // a background refresh never disturbs a visible picker
        }
        return cached;
      }
      // Cold cache: the initial load *is* the fresh load (throws if it fails).
      return loadFresh();
    },
    refresh() {
      return loadFresh();
    },
    async membership(screenName) {
      try {
        return await fetchMembershipListIds({ fetch: deps.fetch, creds: deps.creds() }, screenName);
      } catch {
        // creds() can throw synchronously when logged out — stay quiet, show no marks.
        return [];
      }
    },
  };
}
