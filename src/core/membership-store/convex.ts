import type { XList } from "@/core/x-client/types";

import type { MembershipChange, MembershipHit, MembershipStore, Owner, OwnerCatalog } from "./types";

/** The Convex calls the store needs — the real ConvexClient satisfies this structurally. */
export interface ConvexCalls {
  mutation(ref: unknown, args: Record<string, unknown>): Promise<unknown>;
  query(ref: unknown, args: Record<string, unknown>): Promise<unknown>;
}

/** Opaque `api.membership.*` function references (kept untyped so src/ doesn't import convex/_generated). */
export interface MembershipApiRefs {
  recordAssign: unknown;
  reconcileAuthor: unknown;
  reconcileCatalog: unknown;
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
interface CatalogGroup {
  owner: Owner;
  lists: CatalogList[];
}

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
 * over a Convex client, stamping the device key on every call. Every method is a
 * one-shot call; the picker layers reactive subscriptions on top (ADR-0009).
 */
export class ConvexMembershipStore implements MembershipStore {
  constructor(
    private readonly client: ConvexCalls,
    private readonly api: MembershipApiRefs,
    private readonly deviceKey: string,
  ) {}

  async recordAssign(owner: Owner, list: XList, changes: MembershipChange[]): Promise<void> {
    await this.client.mutation(this.api.recordAssign, {
      deviceKey: this.deviceKey,
      owner,
      list: listArg(list),
      results: changes.map((c) => ({
        memberScreenName: c.screenName,
        ...(c.userId !== undefined ? { memberUserId: c.userId } : {}),
        action: c.action,
        outcome: c.outcome,
      })),
    });
  }

  async reconcileAuthor(owner: Owner, screenName: string, listIds: string[]): Promise<void> {
    await this.client.mutation(this.api.reconcileAuthor, {
      deviceKey: this.deviceKey,
      owner,
      screenName,
      listIds,
    });
  }

  async reconcileCatalog(owner: Owner, lists: XList[]): Promise<void> {
    await this.client.mutation(this.api.reconcileCatalog, {
      deviceKey: this.deviceKey,
      owner,
      lists: lists.map(listArg),
    });
  }

  async listsContaining(screenName: string): Promise<MembershipHit[]> {
    return (await this.client.query(this.api.listsContaining, {
      deviceKey: this.deviceKey,
      screenName,
    })) as MembershipHit[];
  }

  async catalog(): Promise<OwnerCatalog[]> {
    const groups = (await this.client.query(this.api.catalog, {
      deviceKey: this.deviceKey,
    })) as CatalogGroup[];
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
        ...(times.length > 0 ? { lastReconciledAt: Math.max(...times) } : {}),
      };
    });
  }
}
