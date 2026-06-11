import { computed, type ReadonlySignal, signal } from "@preact/signals-core";

import { fuzzyRank } from "@/core/fuzzy";
import type { ListCache } from "@/core/list-cache";
import type { TweetAuthor } from "@/core/selection-store";
import { XApiError, type XList } from "@/core/x-client/types";

/**
 * Headless state for the List picker's five designed states (story beats 4 & 8):
 * loading skeletons / error / empty / no-match / ready. Opens cache-first (the
 * blocking force:true fetch is deleted) and refreshes silently in the background,
 * so the picker feels faster than X. Membership checks ("already in") load for
 * single-person opens only and never block anything.
 */

export type PickerStatus = "loading" | "ready" | "empty" | "error";
export type PickerErrorKind = "auth" | "rate-limited" | "unknown";
export type GroupLabel = "Recent" | "All Lists" | null;

export interface PickerGroup {
  label: GroupLabel;
  rows: XList[];
}

export interface PickerControllerDeps {
  cache: ListCache;
  /** Recently used list ids for the Recent group (see ListUsage.recentIds). */
  recentIds?: (limit: number) => Promise<string[]>;
  /** Owned-list ids already containing a screen name (lists-provider). */
  memberships?: (screenName: string) => Promise<string[]>;
  /** Max rows in the Recent group. */
  recentLimit?: number;
}

export interface PickerController {
  status: ReadonlySignal<PickerStatus>;
  errorKind: ReadonlySignal<PickerErrorKind>;
  query: ReadonlySignal<string>;
  groups: ReadonlySignal<PickerGroup[]>;
  /** Visual order flattened — what ↑/↓ navigate. */
  flat: ReadonlySignal<XList[]>;
  activeIndex: ReadonlySignal<number>;
  active: ReadonlySignal<XList | null>;
  alreadyIn: ReadonlySignal<ReadonlySet<string>>;
  noMatch: ReadonlySignal<boolean>;
  open(authors: TweetAuthor[]): Promise<void>;
  retry(): Promise<void>;
  setQuery(q: string): void;
  moveUp(): void;
  moveDown(): void;
}

const clamp = (i: number, len: number): number =>
  len === 0 ? 0 : Math.max(0, Math.min(i, len - 1));

export function createPickerController(deps: PickerControllerDeps): PickerController {
  const recentLimit = deps.recentLimit ?? 5;
  const status = signal<PickerStatus>("loading");
  const errorKind = signal<PickerErrorKind>("unknown");
  const query = signal("");
  const activeIndex = signal(0);
  const lists = signal<XList[]>([]);
  const recents = signal<string[]>([]);
  const alreadyIn = signal<ReadonlySet<string>>(new Set());
  let generation = 0; // ignores async results from a superseded open()

  const groups = computed<PickerGroup[]>(() => {
    const q = query.value.trim();
    if (q) return [{ label: null, rows: fuzzyRank(q, lists.value, (l) => l.name) }];
    const byId = new Map(lists.value.map((l) => [l.id, l]));
    const recentRows = recents.value
      .map((id) => byId.get(id))
      .filter((l): l is XList => l !== undefined)
      .slice(0, recentLimit);
    const recentIds = new Set(recentRows.map((l) => l.id));
    const rest = lists.value.filter((l) => !recentIds.has(l.id));
    return recentRows.length > 0
      ? [
          { label: "Recent", rows: recentRows },
          { label: "All Lists", rows: rest },
        ]
      : [{ label: null, rows: rest }];
  });

  const flat = computed(() => groups.value.flatMap((g) => g.rows));
  const active = computed<XList | null>(
    () => flat.value[clamp(activeIndex.value, flat.value.length)] ?? null,
  );
  const noMatch = computed(
    () => status.value === "ready" && query.value.trim() !== "" && flat.value.length === 0,
  );

  function applyLists(fresh: XList[]): void {
    lists.value = fresh;
    status.value = fresh.length > 0 ? "ready" : "empty";
  }

  function applyError(e: unknown): void {
    status.value = "error";
    errorKind.value =
      e instanceof XApiError && (e.kind === "auth" || e.kind === "rate-limited")
        ? e.kind
        : "unknown";
  }

  async function load(opts: { force: boolean }): Promise<void> {
    const gen = generation;
    try {
      const fresh = await deps.cache.lists(opts.force ? { force: true } : undefined);
      if (gen !== generation) return;
      applyLists(fresh);
      if (!opts.force) {
        // Cache-first: what we just showed may be stale — refresh silently.
        void deps.cache
          .lists({ force: true })
          .then((latest) => {
            if (gen === generation && latest.length > 0) applyLists(latest);
          })
          .catch(() => {}); // background refresh never disturbs a visible picker
      }
    } catch (e) {
      if (gen === generation) applyError(e);
    }
  }

  return {
    status,
    errorKind,
    query,
    groups,
    flat,
    activeIndex,
    active,
    alreadyIn,
    noMatch,
    async open(authors) {
      generation++;
      const gen = generation;
      query.value = "";
      activeIndex.value = 0;
      alreadyIn.value = new Set();
      status.value = lists.value.length > 0 ? "ready" : "loading";

      if (deps.recentIds) {
        try {
          const ids = await deps.recentIds(recentLimit);
          if (gen === generation) recents.value = ids;
        } catch {
          // usage data is an enhancement; the picker opens without it
        }
      }

      const single = authors.length === 1 ? authors[0] : undefined;
      const memberships = deps.memberships;
      if (single && memberships) {
        // Promise.resolve().then(...) contains a SYNCHRONOUS throw too (e.g.
        // auth.credentials() throwing when logged out) — a bare memberships()
        // call would otherwise escape open(), which callers invoke as `void`.
        void Promise.resolve()
          .then(() => memberships(single.screenName))
          .then((ids) => {
            if (gen === generation) alreadyIn.value = new Set(ids);
          })
          .catch(() => {});
      }

      await load({ force: false });
    },
    async retry() {
      generation++;
      status.value = "loading";
      await load({ force: true });
    },
    setQuery(q) {
      query.value = q;
      activeIndex.value = 0;
    },
    moveUp() {
      activeIndex.value = clamp(activeIndex.value - 1, flat.value.length);
    },
    moveDown() {
      activeIndex.value = clamp(activeIndex.value + 1, flat.value.length);
    },
  };
}
