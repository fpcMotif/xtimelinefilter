import type { XList } from "@/core/x-client/types";

import type {
  CompleteCatalogSnapshot,
  MembershipHit,
  MembershipPerson,
  MembershipStore,
  MembershipSubject,
  MirrorSnapshot,
  Owner,
  OwnerCatalog,
  ObservedMembershipChanges,
  ObservedMembershipSnapshot,
} from "./types";

/** The Convex calls the store needs — the real ConvexClient satisfies this structurally. */
export interface ConvexCalls {
  mutation(ref: unknown, args: Record<string, unknown>): Promise<unknown>;
  query(ref: unknown, args: Record<string, unknown>): Promise<unknown>;
}

/** Opaque `api.membership.*` function references (kept untyped so src/ doesn't import convex/_generated). */
export interface MembershipApiRefs {
  recordAssign: unknown;
  reconcileAuthor: unknown;
  replaceCatalog: unknown;
  listsContaining: unknown;
  catalog: unknown;
}

interface CatalogList {
  listId: string;
  name: string;
  isPrivate?: boolean;
  memberCount?: number;
  lastReconciledAt?: number;
}
/** Wire shape of `api.membership.catalog`. Pinned to the backend by a compile-time
 *  guard in convex-client.ts (the only file that may see convex/_generated). */
export interface CatalogGroup {
  owner: Owner;
  lists: CatalogList[];
  lastReconciledAt?: number;
}

export type MirrorObserver = (
  subject: MembershipSubject,
  emit: (snapshot: MirrorSnapshot) => void,
) => () => void;

/** XList -> the Convex list arg, omitting absent optionals (Convex rejects undefined). */
function listArg(l: XList): Record<string, unknown> {
  return {
    listId: l.id,
    name: l.name,
    ...(l.isPrivate !== undefined ? { isPrivate: l.isPrivate } : {}),
    ...(l.memberCount !== undefined ? { memberCount: l.memberCount } : {}),
  };
}

/**
 * The real Mirror: maps the {@link MembershipStore} seam onto `api.membership.*`
 * over a Convex client, stamping the device key on every call. Private reads
 * exist only for the non-reactive observe fallback (ADR-0009).
 */
export class ConvexMembershipStore implements MembershipStore {
  constructor(
    private readonly client: ConvexCalls,
    private readonly api: MembershipApiRefs,
    private readonly deviceKey: string,
    private readonly observer?: MirrorObserver,
  ) {}

  async recordAssign(
    owner: Owner,
    list: XList,
    observation: ObservedMembershipChanges,
  ): Promise<void> {
    await this.client.mutation(this.api.recordAssign, {
      deviceKey: this.deviceKey,
      owner,
      ownerObservedAt: observation.ownerObservedAt,
      list: listArg(list),
      results: observation.changes.map((c) => ({
        memberScreenName: c.screenName,
        ...(c.userId !== undefined ? { memberUserId: c.userId } : {}),
        ...(c.identity !== null ? { memberIdentity: c.identity } : {}),
        action: c.action,
        outcome: c.outcome,
        observedAt: c.observedAt,
      })),
    });
  }

  async reconcileAuthor(
    owner: Owner,
    person: MembershipPerson,
    snapshot: ObservedMembershipSnapshot,
  ): Promise<void> {
    await this.client.mutation(this.api.reconcileAuthor, {
      deviceKey: this.deviceKey,
      owner,
      screenName: person.screenName,
      memberIdentity: person.identity,
      listIds: snapshot.listIds,
      observedAt: snapshot.observedAt,
      ownerObservedAt: snapshot.ownerObservedAt,
    });
  }

  async replaceCatalog(owner: Owner, snapshot: CompleteCatalogSnapshot): Promise<void> {
    await this.client.mutation(this.api.replaceCatalog, {
      deviceKey: this.deviceKey,
      owner,
      observedAt: snapshot.observedAt,
      ownerObservedAt: snapshot.ownerObservedAt,
      lists: snapshot.lists.map(listArg),
    });
  }

  private async readMemberships(identity: MembershipPerson["identity"]): Promise<MembershipHit[]> {
    // Cast is proven safe by ASSERT_LISTS_CONTAINING in convex-client.ts, which
    // checks the backend's generated return type against MembershipHit[].
    return (await this.client.query(this.api.listsContaining, {
      deviceKey: this.deviceKey,
      memberIdentity: identity,
    })) as MembershipHit[];
  }

  private async readCatalog(): Promise<OwnerCatalog[]> {
    // Cast proven safe by ASSERT_CATALOG in convex-client.ts.
    const groups = (await this.client.query(this.api.catalog, {
      deviceKey: this.deviceKey,
    })) as CatalogGroup[];
    return catalogGroups(groups);
  }

  observe(subject: MembershipSubject, emit: (snapshot: MirrorSnapshot) => void): () => void {
    if (this.observer) return this.observer(subject, emit);
    let active = true;
    void Promise.all([
      this.readCatalog(),
      subject.kind === "single"
        ? this.readMemberships(subject.identity)
        : Promise.resolve<MembershipHit[]>([]),
    ])
      .then(([catalog, memberships]) => {
        if (active) emit({ catalog, memberships });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }
}

export function catalogGroups(groups: CatalogGroup[]): OwnerCatalog[] {
  return groups.map((g) => {
    const times = g.lists
      .map((l) => l.lastReconciledAt)
      .filter((t): t is number => t !== undefined);
    const lists: XList[] = g.lists.map((l) => ({
      id: l.listId,
      name: l.name,
      ...(l.isPrivate !== undefined ? { isPrivate: l.isPrivate } : {}),
      ...(l.memberCount !== undefined ? { memberCount: l.memberCount } : {}),
    }));
    return {
      owner: g.owner,
      lists,
      ...(g.lastReconciledAt !== undefined
        ? { lastReconciledAt: g.lastReconciledAt }
        : times.length > 0
          ? { lastReconciledAt: Math.max(...times) }
          : {}),
    };
  });
}
