import type {
  BookmarkEvidence,
  CollectionStore,
  Folder,
  FolderMembership,
  SavedPost,
} from "./types";

/** The independent records that make up one replicated Folder collection. */
export type ReplicaEntity =
  | { kind: "folder"; key: string; folderId: string; value: Folder | null }
  | { kind: "saved-post"; key: string; statusId: string; value: SavedPost | null }
  | {
      kind: "folder-membership";
      key: string;
      folderId: string;
      statusId: string;
      value: FolderMembership | null;
    }
  | {
      kind: "bookmark-evidence";
      key: string;
      statusId: string;
      xAccountId: string;
      value: BookmarkEvidence | null;
    };

/**
 * A durable, idempotent local change. `baseRevision` is the remote version this
 * installation last observed for the entity; zero means it has never observed
 * that entity on this configured replica. A multi-Folder reorder carries one
 * complete atomic group so Convex can reject it as a unit instead of accepting
 * a partial sort order.
 */
export interface ReplicaMutation {
  operationId: string;
  baseRevision: number;
  entity: ReplicaEntity;
  atomicGroupId?: string;
  atomicGroupSize?: number;
}

/** A mutation accepted by Convex and ordered in the replica's change stream. */
export interface ReplicaChange extends ReplicaMutation {
  revision: number;
}

export interface ReplicaPushResult {
  operationId: string;
  status: "accepted" | "conflict";
  revision: number;
}

export interface ReplicaPushResponse {
  results: ReplicaPushResult[];
}

export interface ReplicaPullResponse {
  changes: ReplicaChange[];
  cursor: number;
  done: boolean;
}

/**
 * The remote half of the replica seam. The worker owns scheduling and local
 * persistence; an adapter only accepts mutations and pages ordered changes.
 * `pull` returns the final delivered revision as `cursor`, or leaves it
 * unchanged for an empty page.
 */
export interface CollectionReplicaRemote {
  push(mutations: readonly ReplicaMutation[]): Promise<ReplicaPushResponse>;
  pull(params: { cursor: number; limit: number }): Promise<ReplicaPullResponse>;
}

/** The current connection outcome visible to the Folders workshop. */
export interface CollectionReplicaStatus {
  state: "local-only" | "syncing" | "current" | "offline" | "failed" | "conflict";
  updatedAt: number | null;
  error: string | null;
  conflicts: number;
}

/** A configuration identity fences work from a previous Convex URL or device key. */
export interface CollectionReplicaConfig {
  configurationId: string;
}

/**
 * Optional extension of the local Collection Store. Production IndexedDB
 * implements it; injected stores used by focused tests can omit it and remain
 * local-only.
 */
export interface ReplicatedCollectionStore extends CollectionStore {
  synchronizeReplica(
    config: CollectionReplicaConfig,
    remote: CollectionReplicaRemote,
  ): Promise<CollectionReplicaStatus>;
  replicaStatus(config: CollectionReplicaConfig): Promise<CollectionReplicaStatus>;
}

export function isReplicatedCollectionStore(
  store: CollectionStore,
): store is ReplicatedCollectionStore {
  const candidate = store as Partial<ReplicatedCollectionStore>;
  return (
    typeof candidate.synchronizeReplica === "function" &&
    typeof candidate.replicaStatus === "function"
  );
}
