import { computed, type ReadonlySignal, signal } from "@preact/signals-core";

import { fuzzyRank } from "@/core/fuzzy";
import type { ListCache } from "@/core/list-cache";
import { membershipIdentityOf } from "@/core/membership-store/identity";
import { NullMembershipStore } from "@/core/membership-store/null";
import type {
  MembershipHit,
  MembershipStore,
  ObservedMembershipSnapshot,
  Owner,
  OwnerCatalog,
} from "@/core/membership-store/types";
import type { TweetAuthor } from "@/core/selection-store";
import { XApiError, type XList } from "@/core/x-client/types";

export type PickerStatus = "loading" | "ready" | "empty" | "error";
export type PickerErrorKind = "auth" | "rate-limited" | "unknown";
export type PickerScope =
  | { readonly kind: "owner"; readonly ownerUserId: string }
  | { readonly kind: "all" };

export type PickerMembership =
  | { readonly kind: "present" | "absent"; readonly source: "x-live" }
  | {
      readonly kind: "present" | "absent";
      readonly source: "mirror-cached";
      readonly asOf: number;
    }
  | { readonly kind: "unknown" };

export interface PickerRow {
  readonly key: string;
  readonly owner: Readonly<Owner> | null;
  readonly list: Readonly<XList>;
  readonly access:
    | { readonly kind: "writable"; readonly freshness: "live" | "cached" }
    | {
        readonly kind: "read-only";
        readonly reason: "switch-owner";
        readonly asOf?: number;
      };
  readonly membership: PickerMembership;
}

export interface PickerGroup {
  readonly label: string | null;
  readonly rows: readonly PickerRow[];
}

export interface OwnerTab {
  readonly owner: Readonly<Owner>;
  readonly freshness:
    | { readonly kind: "active" }
    | { readonly kind: "cached"; readonly asOf?: number };
}

export interface PickerView {
  /** Immutable Selection captured by open; render and chosen effects share this action target. */
  readonly authors: readonly Readonly<TweetAuthor>[];
  readonly status: PickerStatus;
  readonly errorKind: PickerErrorKind;
  readonly query: string;
  readonly owners: readonly OwnerTab[];
  readonly scope: PickerScope;
  readonly groups: readonly PickerGroup[];
  readonly flat: readonly PickerRow[];
  readonly activeIndex: number;
  readonly active: PickerRow | null;
  readonly noMatch: boolean;
}

export type PickerIntent =
  | { type: "query"; value: string }
  | { type: "move"; direction: "up" | "down" }
  | { type: "select-scope"; scope: PickerScope }
  | { type: "choose"; rowKey: string }
  | { type: "retry" }
  | { type: "close" };

export type PickerEffect = {
  type: "chosen";
  owner: Owner | null;
  list: XList;
  authors: readonly Readonly<TweetAuthor>[];
} | null;

export interface PickerControllerDeps {
  cache: ListCache;
  currentOwner: () => Owner | null;
  membershipStore?: MembershipStore;
  recentIds?: (ownerUserId: string, limit: number) => Promise<string[]>;
  /** `null` means X did not confirm membership; callers retain unknown rows. */
  memberships?: (screenName: string) => Promise<string[] | null>;
  recentLimit?: number;
  now?: () => number;
}

export interface PickerController {
  /** Complete render state. Callers never combine independently timed signals. */
  readonly view: ReadonlySignal<PickerView>;
  /** Starts one generation. Older reads and Reconciles cannot publish afterward. */
  open(authors: readonly TweetAuthor[]): Promise<void>;
  /** The only UI mutation path. A stale Owner starts a fresh open and emits no effect. */
  act(intent: PickerIntent): PickerEffect;
}

interface ActiveCatalog {
  owner: Owner | null;
  lists: XList[];
  freshness: "live" | "cached";
}

interface ProjectedCatalog {
  owner: Owner | null;
  lists: XList[];
  lastReconciledAt?: number;
}

interface ChoiceTarget {
  owner: Owner | null;
  list: XList;
  access: PickerRow["access"];
}

const catalogKey = (ownerUserId: string | null, listId: string): string =>
  `${ownerUserId ?? "current"}:${listId}`;
const rowKey = (openGeneration: number, ownerUserId: string | null, listId: string): string =>
  `${openGeneration}:${catalogKey(ownerUserId, listId)}`;
const hitKey = (hit: Pick<MembershipHit, "ownerUserId" | "listId">): string =>
  catalogKey(hit.ownerUserId, hit.listId);
const clamp = (index: number, length: number): number =>
  length === 0 ? 0 : Math.max(0, Math.min(index, length - 1));
const noop = (): void => {};
const snapshotOwner = (owner: Owner | null): Owner | null =>
  owner ? Object.freeze({ ...owner }) : null;
const snapshotList = (list: XList): XList => Object.freeze({ ...list });
const snapshotLists = (lists: readonly XList[]): XList[] => lists.map(snapshotList);
const sameOwner = (left: Owner | null, right: Owner | null): boolean =>
  left?.userId === right?.userId;
const classify = (error: unknown): PickerErrorKind =>
  error instanceof XApiError && (error.kind === "auth" || error.kind === "rate-limited")
    ? error.kind
    : "unknown";

export function createPickerController(deps: PickerControllerDeps): PickerController {
  const store = deps.membershipStore ?? new NullMembershipStore();
  const recentLimit = deps.recentLimit ?? 5;
  const now = deps.now ?? Date.now;
  const status = signal<PickerStatus>("loading");
  const errorKind = signal<PickerErrorKind>("unknown");
  const query = signal("");
  const scope = signal<PickerScope>({ kind: "all" });
  const activeRowKey = signal<string | null>(null);
  const activeOwner = signal<Owner | null>(null);
  const activeCatalog = signal<ActiveCatalog | null>(null);
  const mirrorCatalog = signal<OwnerCatalog[]>([]);
  const mirrorMemberships = signal<MembershipHit[]>([]);
  const xMemberships = signal<ReadonlySet<string> | null>(null);
  const recents = signal<string[]>([]);
  const selectedAuthors = signal<readonly TweetAuthor[]>([]);
  let generation = 0;
  let lastAuthors: readonly TweetAuthor[] = [];
  let stopObserving = noop;
  let choiceConsumed = false;
  let choiceTargets = new Map<string, ChoiceTarget>();

  /** Optional Mirror cleanup is never allowed to break Picker state transitions. */
  const disposeMirror = (): void => {
    const dispose = stopObserving;
    stopObserving = noop;
    try {
      dispose();
    } catch {
      // The Mirror remains optional even when an adapter disposer is broken.
    }
  };

  const view = computed<PickerView>(() => {
    const owner = activeOwner.value;
    const active = activeCatalog.value;
    const catalogs = new Map<string, OwnerCatalog>();
    for (const catalog of mirrorCatalog.value) {
      if (catalog.owner.userId !== owner?.userId) catalogs.set(catalog.owner.userId, catalog);
    }
    const ordered: ProjectedCatalog[] = [...catalogs.values()].sort((a, b) =>
      a.owner.screenName.localeCompare(b.owner.screenName),
    );
    if (active) ordered.unshift({ owner: active.owner, lists: active.lists });
    const selectedScope = scope.value;
    const visible =
      selectedScope.kind === "all"
        ? ordered
        : ordered.filter((catalog) => catalog.owner?.userId === selectedScope.ownerUserId);
    const hits = new Map(mirrorMemberships.value.map((hit) => [hitKey(hit), hit]));
    const q = query.value.trim();
    const groups: PickerGroup[] = [];
    const projectedTargets = new Map<string, ChoiceTarget>();

    for (const catalog of visible) {
      const writableCatalog =
        active &&
        (catalog.owner ? active.owner?.userId === catalog.owner.userId : active.owner === null)
          ? active
          : null;
      const rows = catalog.lists.map((list): PickerRow => {
        const key = rowKey(generation, catalog.owner?.userId ?? null, list.id);
        const hit = hits.get(catalogKey(catalog.owner?.userId ?? null, list.id));
        const live = writableCatalog ? xMemberships.value : null;
        const membership: PickerMembership = writableCatalog
          ? live
            ? {
                kind: live.has(list.id) ? "present" : "absent",
                source: "x-live",
              }
            : { kind: "unknown" }
          : hit
            ? {
                kind: hit.present ? "present" : "absent",
                source: "mirror-cached",
                asOf: hit.lastSeenAt,
              }
            : { kind: "unknown" };
        const targetOwner = snapshotOwner(catalog.owner);
        const targetList = snapshotList(list);
        const access: PickerRow["access"] = writableCatalog
          ? Object.freeze({
              kind: "writable",
              freshness: writableCatalog.freshness,
            })
          : Object.freeze({
              kind: "read-only",
              reason: "switch-owner",
              ...(catalog.lastReconciledAt === undefined ? {} : { asOf: catalog.lastReconciledAt }),
            });
        projectedTargets.set(key, {
          owner: targetOwner,
          list: targetList,
          access,
        });
        return {
          key,
          owner: targetOwner ? { ...targetOwner } : null,
          list: { ...targetList },
          access: { ...access },
          membership,
        };
      });
      const ranked = q ? fuzzyRank(q, rows, (row) => row.list.name) : rows;
      if (selectedScope.kind === "all") {
        groups.push({
          label: catalog.owner ? `@${catalog.owner.screenName}` : "Current account",
          rows: ranked,
        });
        continue;
      }
      if (!q && writableCatalog) {
        const byId = new Map(ranked.map((row) => [row.list.id, row]));
        const recentRows = recents.value
          .map((id) => byId.get(id))
          .filter((row): row is PickerRow => row !== undefined)
          .slice(0, recentLimit);
        const recentSet = new Set(recentRows.map((row) => row.list.id));
        if (recentRows.length > 0) groups.push({ label: "Recent", rows: recentRows });
        groups.push({
          label: recentRows.length > 0 ? "All Lists" : null,
          rows: ranked.filter((row) => !recentSet.has(row.list.id)),
        });
      } else {
        groups.push({ label: null, rows: ranked });
      }
    }

    const flat = groups.flatMap((group) => group.rows);
    // Each row is projected only after its target is recorded above.
    choiceTargets = new Map(flat.map((row) => [row.key, projectedTargets.get(row.key)!]));
    const requestedIndex = activeRowKey.value
      ? flat.findIndex((row) => row.key === activeRowKey.value)
      : 0;
    const activeIndex = clamp(requestedIndex < 0 ? 0 : requestedIndex, flat.length);
    const visibleStatus =
      status.value === "ready" && flat.length === 0 && q === "" ? "empty" : status.value;
    return {
      authors: selectedAuthors.value,
      status: visibleStatus,
      errorKind: errorKind.value,
      query: query.value,
      owners: ordered
        .filter((catalog): catalog is ProjectedCatalog & { owner: Owner } => catalog.owner !== null)
        .map((catalog) => ({
          owner: catalog.owner,
          freshness:
            catalog.owner.userId === owner?.userId
              ? { kind: "active" }
              : {
                  kind: "cached",
                  ...(catalog.lastReconciledAt === undefined
                    ? {}
                    : { asOf: catalog.lastReconciledAt }),
                },
        })),
      scope: selectedScope,
      groups,
      flat,
      activeIndex,
      active: flat[activeIndex] ?? null,
      noMatch: visibleStatus === "ready" && q !== "" && flat.length === 0,
    };
  });

  const isCurrent = (candidate: number): boolean => candidate === generation;

  async function readEnhancements(
    candidate: number,
    owner: Owner | null,
    ownerObservedAt: number,
    single: TweetAuthor | undefined,
    authors: readonly TweetAuthor[],
  ): Promise<{ membershipSnapshot: ObservedMembershipSnapshot | null }> {
    const membershipsPromise =
      single && deps.memberships
        ? Promise.resolve().then(async () => {
            const observedAt = now();
            const listIds = await deps.memberships!(single.screenName);
            return listIds === null ? null : { listIds, observedAt, ownerObservedAt };
          })
        : Promise.resolve(null);
    const [recentsResult, membershipsResult] = await Promise.allSettled([
      owner && deps.recentIds ? deps.recentIds(owner.userId, recentLimit) : Promise.resolve([]),
      membershipsPromise,
    ]);
    if (!isCurrent(candidate)) return { membershipSnapshot: null };
    if (!sameOwner(owner, deps.currentOwner())) {
      void open(authors);
      return { membershipSnapshot: null };
    }
    if (recentsResult.status === "fulfilled") recents.value = recentsResult.value;
    if (membershipsResult.status === "rejected") {
      console.error("[Picker] Memberships retrieval failed:", membershipsResult.reason);
    }
    const membershipSnapshot =
      membershipsResult.status === "fulfilled" ? membershipsResult.value : null;
    if (membershipSnapshot) xMemberships.value = new Set(membershipSnapshot.listIds);
    return { membershipSnapshot };
  }

  async function open(authors: readonly TweetAuthor[]): Promise<void> {
    const candidate = ++generation;
    disposeMirror();
    choiceConsumed = false;
    const openedAuthors = Object.freeze(authors.map((author) => Object.freeze({ ...author })));
    lastAuthors = openedAuthors;
    selectedAuthors.value = openedAuthors;
    const owner = snapshotOwner(deps.currentOwner());
    const ownerObservedAt = now();
    query.value = "";
    activeRowKey.value = null;
    activeOwner.value = owner;
    activeCatalog.value = null;
    mirrorCatalog.value = [];
    mirrorMemberships.value = [];
    xMemberships.value = null;
    recents.value = [];
    errorKind.value = "unknown";
    status.value = "loading";

    scope.value = owner ? { kind: "owner", ownerUserId: owner.userId } : { kind: "all" };
    const single = openedAuthors.length === 1 ? openedAuthors[0] : undefined;
    const singleIdentity = single ? membershipIdentityOf(single) : null;

    if (owner) {
      try {
        stopObserving = store.observe(
          singleIdentity ? { kind: "single", identity: singleIdentity } : { kind: "bulk" },
          (snapshot) => {
            if (!isCurrent(candidate)) return;
            mirrorCatalog.value = snapshot.catalog;
            mirrorMemberships.value = singleIdentity ? snapshot.memberships : [];
          },
        );
      } catch {
        // Mirror subscriptions are optional and fail-open.
      }
    }

    void Promise.resolve()
      .then(() => deps.cache.cached(owner))
      .then((cached) => {
        if (!isCurrent(candidate) || cached === null) return;
        if (!sameOwner(owner, deps.currentOwner())) {
          void open(openedAuthors);
          return;
        }
        if (activeCatalog.value?.freshness === "live") return;
        activeCatalog.value = {
          owner,
          lists: snapshotLists(cached),
          freshness: "cached",
        };
        status.value = "ready";
      })
      .catch(() => {});
    // Fence cross-tab responses by fetch start, not arrival. A slow older answer
    // must not replace a newer complete catalog that reached the Mirror first.
    const freshPromise = Promise.resolve().then(async () => {
      const observedAt = now();
      const lists = await deps.cache.refresh(owner);
      return { lists, observedAt };
    });
    // Queue the catalog fetch first. Its scope must be no newer than the Author
    // membership fetch that will reconcile against it.
    const enhancementsPromise = readEnhancements(
      candidate,
      owner,
      ownerObservedAt,
      single,
      openedAuthors,
    );
    let freshResult: { lists: XList[]; observedAt: number };
    try {
      freshResult = await freshPromise;
    } catch (error) {
      if (isCurrent(candidate) && !sameOwner(owner, deps.currentOwner())) {
        await open(openedAuthors);
        return;
      }
      if (isCurrent(candidate) && activeCatalog.value === null) {
        errorKind.value = classify(error);
        status.value = "error";
      }
      await enhancementsPromise;
      return;
    }
    const { lists: fresh, observedAt } = freshResult;
    if (!isCurrent(candidate)) {
      await enhancementsPromise;
      return;
    }
    if (!sameOwner(owner, deps.currentOwner())) {
      await open(openedAuthors);
      return;
    }
    const freshSnapshot = snapshotLists(fresh);
    activeCatalog.value = { owner, lists: freshSnapshot, freshness: "live" };
    status.value = "ready";

    try {
      if (owner) {
        await store.replaceCatalog(owner, {
          lists: freshSnapshot,
          observedAt,
          ownerObservedAt,
        });
      }
    } catch {
      // Each Mirror write is independently fail-open.
    }
    const { membershipSnapshot } = await enhancementsPromise;
    if (!isCurrent(candidate)) return;
    if (!sameOwner(owner, deps.currentOwner())) {
      await open(openedAuthors);
      return;
    }
    try {
      if (owner && single && singleIdentity && membershipSnapshot) {
        await store.reconcileAuthor(
          owner,
          { screenName: single.screenName, identity: singleIdentity },
          membershipSnapshot,
        );
      }
    } catch {
      // Each Mirror write is independently fail-open.
    }
  }

  return {
    view,
    open,
    act(intent) {
      if (intent.type === "query") {
        query.value = intent.value;
        activeRowKey.value = null;
        return null;
      }
      if (intent.type === "move") {
        const { flat, activeIndex } = view.value;
        const delta = intent.direction === "down" ? 1 : -1;
        activeRowKey.value = flat[clamp(activeIndex + delta, flat.length)]?.key ?? null;
        return null;
      }
      if (intent.type === "select-scope") {
        scope.value = { ...intent.scope };
        activeRowKey.value = null;
        return null;
      }
      if (intent.type === "retry") {
        void open(lastAuthors);
        return null;
      }
      if (intent.type === "close") {
        choiceConsumed = true;
        generation++;
        disposeMirror();
        return null;
      }

      if (choiceConsumed) return null;
      void view.value;
      const target = choiceTargets.get(intent.rowKey);
      if (!target) return null;
      const current = deps.currentOwner();
      const openedOwner = activeOwner.value;
      if (!sameOwner(openedOwner, current)) {
        // The captured Selection remains valid, but its Owner-scoped catalog does not.
        // Begin the replacement generation before returning so stale rows cannot assign.
        void open(lastAuthors);
        return null;
      }
      if (target.access.kind === "read-only") return null;
      choiceConsumed = true;
      disposeMirror();
      return {
        type: "chosen",
        owner: openedOwner,
        list: target.list,
        authors: selectedAuthors.value,
      };
    },
  };
}
