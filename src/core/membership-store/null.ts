import type { MembershipHit, MembershipStore, OwnerCatalog } from "./types";

/**
 * The Mirror disabled: every write is a no-op, every read is empty. This is what
 * the extension uses when no device key is configured, so behaviour is identical
 * to having no Mirror at all (ADR-0009 — the Mirror is optional and never
 * load-bearing).
 */
export class NullMembershipStore implements MembershipStore {
  async recordAssign(): Promise<void> {}
  async reconcileAuthor(): Promise<void> {}
  async reconcileCatalog(): Promise<void> {}
  async listsContaining(): Promise<MembershipHit[]> {
    return [];
  }
  async catalog(): Promise<OwnerCatalog[]> {
    return [];
  }
}
