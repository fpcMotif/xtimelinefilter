import type {
  AssignOutcome,
  MutationEvidence,
  RemoveOutcome,
  XList,
} from "@/packages/x-client/types";

import type { MembershipIdentity } from "./lib/identity";

/** One of *your own* X accounts, read when an operation observes its Owner
 *  (ADR-0009). The operator / list owner — distinct from Account/Author. */
export interface Owner {
  /** numeric X id (rest_id), read from the `twid` cookie — the stable identity. */
  userId: string;
  /** best-effort handle for display; may be empty when not yet resolved. */
  screenName: string;
}

/** A snapshot row for one (List, Account): does this List currently contain them. */
export interface MembershipHit {
  listId: string;
  ownerUserId: string;
  present: boolean;
  /** Source observation time; legacy rows fall back to Mirror receipt time. */
  lastSeenAt: number;
}

/** One Owner's Lists in the cross-account catalog. */
export interface OwnerCatalog {
  owner: Owner;
  lists: XList[];
  /** Fetch-start time of this Owner's latest complete catalog — drives the freshness cue. */
  lastReconciledAt?: number;
}

interface MembershipChangeBase {
  screenName: string;
  userId?: string;
  /** Stable cache identity. Null means audit-only: never write a snapshot. */
  identity: MembershipIdentity | null;
  /** When X finished this exact add/remove attempt. */
  observedAt: number;
  /** What accepted this mutation; only a server response may update cached facts. */
  evidence: MutationEvidence;
}

/** One mirrored add or remove result. Direction and outcome stay coupled. */
export type MembershipChange =
  | (MembershipChangeBase & { action: "add"; outcome: AssignOutcome })
  | (MembershipChangeBase & { action: "remove"; outcome: RemoveOutcome });

/** Direct membership facts, each timed at its own X attempt completion. */
export interface ObservedMembershipChanges {
  changes: readonly MembershipChange[];
  /** When the acting Owner profile was read. */
  ownerObservedAt: number;
}

export type MembershipSubject = { kind: "single"; identity: MembershipIdentity } | { kind: "bulk" };

export interface MembershipPerson {
  screenName: string;
  identity: MembershipIdentity;
}

/** X's complete membership answer for one person, timed when its fetch began. */
export interface ObservedMembershipSnapshot {
  listIds: readonly string[];
  observedAt: number;
  /** When the Owner profile attached to this fetch was read. */
  ownerObservedAt: number;
}

export interface MirrorSnapshot {
  catalog: OwnerCatalog[];
  memberships: MembershipHit[];
}

/** X's complete owned-Lists answer, fenced by the time its fetch began. */
export interface CompleteCatalogSnapshot {
  lists: readonly XList[];
  observedAt: number;
  /** When the Owner profile attached to this fetch was read. */
  ownerObservedAt: number;
}

/**
 * The seam the extension talks to the Mirror through (sibling of `XListApi`).
 * Writes mirror what X did; observe supplies optional snapshots to the picker.
 * The Mirror is never the source of truth and failures never break the X flow.
 */
export interface MembershipStore {
  /** Mirror the changes from one assign/undo run, stamped with the acting Owner. */
  recordAssign(owner: Owner, list: XList, observation: ObservedMembershipChanges): Promise<void>;
  /** Mirror X's truth for one Account: the Owner's Lists that currently contain them. */
  reconcileAuthor(
    owner: Owner,
    person: MembershipPerson,
    snapshot: ObservedMembershipSnapshot,
  ): Promise<void>;
  /** Replace this Owner's catalog unless a newer complete answer already won. */
  replaceCatalog(owner: Owner, snapshot: CompleteCatalogSnapshot): Promise<void>;
  /** Live cached reads. Errors stay inside the adapter. Disposer is idempotent. */
  observe(subject: MembershipSubject, emit: (snapshot: MirrorSnapshot) => void): () => void;
}

/** Read-only Mirror health check. Kept beside the store so callers never know its transport. */
export interface MembershipStoreProbe {
  probe(config: { url: string; deviceKey: string }): Promise<void>;
}
