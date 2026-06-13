import type { AssignResult, XList } from "@/core/x-client/types";

/** One of *your own* X accounts, captured at action time (ADR-0009). The operator
 *  / list owner — distinct from Account/Author (the member). */
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
  /** epoch ms of the last reconcile/change touching this row — drives the "as of" cue. */
  lastSeenAt: number;
}

/** One Owner's Lists in the cross-account catalog. */
export interface OwnerCatalog {
  owner: Owner;
  lists: XList[];
  lastReconciledAt?: number;
}

/**
 * The seam the extension talks to the Mirror through (sibling of `XListApi`).
 * Writes mirror what we did against X; reads serve the picker. The Mirror is
 * never the source of truth and a failure here must never break the X flow.
 */
export interface MembershipStore {
  /** Mirror the outcomes of one assign/undo run, stamped with the acting Owner. */
  recordAssign(owner: Owner, list: XList, results: AssignResult[]): Promise<void>;
  /** Mirror X's truth for one Account: the Owner's Lists that currently contain them. */
  reconcileAuthor(owner: Owner, screenName: string, listIds: string[]): Promise<void>;
  /** Mirror the active Owner's owned-List catalog. */
  reconcileCatalog(owner: Owner, lists: XList[]): Promise<void>;
  /** Which of the Mirror's Lists currently contain this screenName (powers "already in"). */
  listsContaining(screenName: string): Promise<MembershipHit[]>;
  /** The cross-account catalog: every known Owner's Lists. */
  catalog(): Promise<OwnerCatalog[]>;
}
