import type {
  CollectionReplicaConfig,
  CollectionReplicaRemote,
  CollectionReplicaStatus,
  ReplicaChange,
  ReplicaEntity,
  ReplicaMutation,
  ReplicaPushResult,
} from "../replica";
import type { BookmarkEvidence, Folder, FolderMembership, SavedPost } from "../types";
import { Stores } from "./schema";

const PUSH_BATCH_SIZE = 256;
const PULL_PAGE_SIZE = 100;
const MAX_ERROR_LENGTH = 512;

class ReplicaSyncCancelled extends Error {}

type EntityStateRow = {
  configurationId: string;
  key: string;
  entity: ReplicaEntity;
  fingerprint: string;
  revision: number;
};

type OutboxState = "pending" | "accepted" | "conflict";

type OutboxRow = EntityStateRow & {
  operationId: string;
  state: OutboxState;
  atomicGroupId?: string;
  atomicGroupSize?: number;
};

type LiveFolderOutboxRow = OutboxRow & {
  entity: Extract<ReplicaEntity, { kind: "folder" }> & { value: Folder };
};

type StatusRow = CollectionReplicaStatus & {
  configurationId: string;
  cursor: number;
};

const entityOrder: Record<ReplicaEntity["kind"], number> = {
  folder: 0,
  "saved-post": 1,
  "folder-membership": 2,
  "bookmark-evidence": 3,
};

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

const now = (): number => {
  const value = Date.now();
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

function key(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function folderEntity(value: Folder | null, folderId: string): ReplicaEntity {
  return { kind: "folder", key: key(["folder", folderId]), folderId, value };
}

function savedPostEntity(value: SavedPost | null, statusId: string): ReplicaEntity {
  return { kind: "saved-post", key: key(["saved-post", statusId]), statusId, value };
}

function membershipEntity(
  value: FolderMembership | null,
  folderId: string,
  statusId: string,
): ReplicaEntity {
  return {
    kind: "folder-membership",
    key: key(["folder-membership", folderId, statusId]),
    folderId,
    statusId,
    value,
  };
}

function evidenceEntity(
  value: BookmarkEvidence | null,
  statusId: string,
  xAccountId: string,
): ReplicaEntity {
  return {
    kind: "bookmark-evidence",
    key: key(["bookmark-evidence", statusId, xAccountId]),
    statusId,
    xAccountId,
    value,
  };
}

function deletedEntity(entity: ReplicaEntity): ReplicaEntity {
  switch (entity.kind) {
    case "folder":
      return folderEntity(null, entity.folderId);
    case "saved-post":
      return savedPostEntity(null, entity.statusId);
    case "folder-membership":
      return membershipEntity(null, entity.folderId, entity.statusId);
    case "bookmark-evidence":
      return evidenceEntity(null, entity.statusId, entity.xAccountId);
  }
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .toSorted()
      .map((name) => [name, ordered(record[name])]),
  );
}

function fingerprint(entity: ReplicaEntity): string {
  return JSON.stringify(ordered(entity));
}

function configuredRange(configurationId: string, keyRange: typeof IDBKeyRange): IDBKeyRange {
  return keyRange.bound([configurationId], [configurationId, []]);
}

function cloneStatus(status: CollectionReplicaStatus): CollectionReplicaStatus {
  return {
    state: status.state,
    updatedAt: status.updatedAt,
    error: status.error,
    conflicts: status.conflicts,
  };
}

const LOCAL_ONLY: CollectionReplicaStatus = {
  state: "local-only",
  updatedAt: null,
  error: null,
  conflicts: 0,
};

/**
 * Private replica state co-located with the worker-owned Folders database.
 * It scans the public records before each sync instead of leaking replication
 * bookkeeping into the account-free Collection Store interface.
 */
export class LocalCollectionReplica {
  constructor(
    private readonly db: IDBDatabase,
    private readonly keyRange: typeof IDBKeyRange,
  ) {}

  private transaction(stores: readonly string[], mode: IDBTransactionMode): IDBTransaction {
    return this.db.transaction([...stores], mode);
  }

  private async publicEntities(): Promise<ReplicaEntity[]> {
    const transaction = this.transaction(
      [Stores.FOLDERS, Stores.SAVED_POSTS, Stores.FOLDER_MEMBERSHIPS, Stores.BOOKMARK_EVIDENCE],
      "readonly",
    );
    const folders = requestValue(transaction.objectStore(Stores.FOLDERS).getAll()) as Promise<
      Folder[]
    >;
    const posts = requestValue(transaction.objectStore(Stores.SAVED_POSTS).getAll()) as Promise<
      SavedPost[]
    >;
    const memberships = requestValue(
      transaction.objectStore(Stores.FOLDER_MEMBERSHIPS).getAll(),
    ) as Promise<FolderMembership[]>;
    const evidence = requestValue(
      transaction.objectStore(Stores.BOOKMARK_EVIDENCE).getAll(),
    ) as Promise<BookmarkEvidence[]>;
    const [folderRows, postRows, membershipRows, evidenceRows] = await Promise.all([
      folders,
      posts,
      memberships,
      evidence,
    ]);
    await transactionDone(transaction);
    return [
      ...folderRows.map((row) => folderEntity(row, row.folderId)),
      ...postRows.map((row) => savedPostEntity(row, row.statusId)),
      ...membershipRows.map((row) => membershipEntity(row, row.folderId, row.statusId)),
      ...evidenceRows.map((row) => evidenceEntity(row, row.statusId, row.xAccountId)),
    ];
  }

  private async entityStates(configurationId: string): Promise<EntityStateRow[]> {
    const transaction = this.transaction([Stores.REPLICA_ENTITY_STATE], "readonly");
    const rows = (await requestValue(
      transaction
        .objectStore(Stores.REPLICA_ENTITY_STATE)
        .getAll(configuredRange(configurationId, this.keyRange)),
    )) as EntityStateRow[];
    await transactionDone(transaction);
    return rows;
  }

  private async outbox(configurationId: string): Promise<OutboxRow[]> {
    const transaction = this.transaction([Stores.REPLICA_OUTBOX], "readonly");
    const rows = (await requestValue(
      transaction
        .objectStore(Stores.REPLICA_OUTBOX)
        .getAll(configuredRange(configurationId, this.keyRange)),
    )) as OutboxRow[];
    await transactionDone(transaction);
    return rows;
  }

  private async prepareOutbox(config: CollectionReplicaConfig): Promise<void> {
    const [entities, states] = await Promise.all([
      this.publicEntities(),
      this.entityStates(config.configurationId),
    ]);
    const current = new Map(entities.map((entity) => [entity.key, entity]));
    const prior = new Map(states.map((row) => [row.key, row]));
    const transaction = this.transaction(
      [Stores.REPLICA_ENTITY_STATE, Stores.REPLICA_OUTBOX],
      "readwrite",
    );
    const statesStore = transaction.objectStore(Stores.REPLICA_ENTITY_STATE);
    const outboxStore = transaction.objectStore(Stores.REPLICA_OUTBOX);

    for (const entity of current.values()) {
      const priorState = prior.get(entity.key);
      const currentFingerprint = fingerprint(entity);
      if (priorState?.fingerprint === currentFingerprint) continue;
      const row: EntityStateRow = {
        configurationId: config.configurationId,
        key: entity.key,
        entity,
        fingerprint: currentFingerprint,
        revision: priorState?.revision ?? 0,
      };
      statesStore.put(row);
      outboxStore.put({
        ...row,
        operationId: crypto.randomUUID(),
        state: "pending",
      } satisfies OutboxRow);
    }

    for (const state of prior.values()) {
      if (current.has(state.key)) continue;
      const entity = deletedEntity(state.entity);
      const currentFingerprint = fingerprint(entity);
      if (state.fingerprint === currentFingerprint) continue;
      const row: EntityStateRow = {
        configurationId: config.configurationId,
        key: entity.key,
        entity,
        fingerprint: currentFingerprint,
        revision: state.revision,
      };
      statesStore.put(row);
      outboxStore.put({
        ...row,
        operationId: crypto.randomUUID(),
        state: "pending",
      } satisfies OutboxRow);
    }

    // The state map prevents re-enqueuing a pending or conflicted change until
    // the user changes that entity again.
    await transactionDone(transaction);
    await this.assignAtomicFolderGroups(config);
  }

  private async assignAtomicFolderGroups(config: CollectionReplicaConfig): Promise<void> {
    const candidates = (await this.outbox(config.configurationId)).filter(
      (row): row is LiveFolderOutboxRow =>
        row.state === "pending" &&
        row.entity.kind === "folder" &&
        row.entity.value !== null &&
        row.entity.value.deletedAt === null,
    );
    const byUpdatedAt = new Map<number, LiveFolderOutboxRow[]>();
    for (const row of candidates) {
      const updatedAt = row.entity.value.updatedAt;
      const group = byUpdatedAt.get(updatedAt);
      if (group) group.push(row);
      else byUpdatedAt.set(updatedAt, [row]);
    }
    const groups = [...byUpdatedAt.values()].filter((group) => group.length > 1);
    if (groups.length === 0) return;

    const transaction = this.transaction([Stores.REPLICA_OUTBOX], "readwrite");
    const outbox = transaction.objectStore(Stores.REPLICA_OUTBOX);
    for (const group of groups) {
      const sharedId = group[0]?.atomicGroupId;
      const alreadyGrouped =
        sharedId !== undefined &&
        group.every(
          (row) => row.atomicGroupId === sharedId && row.atomicGroupSize === group.length,
        );
      if (alreadyGrouped) continue;
      const atomicGroupId = crypto.randomUUID();
      for (const row of group) {
        outbox.put({
          ...row,
          atomicGroupId,
          atomicGroupSize: group.length,
        } satisfies OutboxRow);
      }
    }
    await transactionDone(transaction);
  }

  private async pendingMutations(config: CollectionReplicaConfig): Promise<ReplicaMutation[]> {
    const pending = (await this.outbox(config.configurationId))
      .filter((row) => row.state === "pending")
      .toSorted(
        (left, right) =>
          entityOrder[left.entity.kind] - entityOrder[right.entity.kind] ||
          left.key.localeCompare(right.key),
      );
    const groups = new Map<string, OutboxRow[]>();
    for (const row of pending) {
      if (!row.atomicGroupId) continue;
      const group = groups.get(row.atomicGroupId);
      if (group) group.push(row);
      else groups.set(row.atomicGroupId, [row]);
    }
    const selected: OutboxRow[] = [];
    const selectedKeys = new Set<string>();
    for (const row of pending) {
      if (selectedKeys.has(row.key)) continue;
      const members = row.atomicGroupId ? groups.get(row.atomicGroupId) : undefined;
      const batch = members ?? [row];
      if (
        row.atomicGroupId &&
        (row.atomicGroupSize !== batch.length ||
          batch.some(
            (member) =>
              member.atomicGroupId !== row.atomicGroupId ||
              member.atomicGroupSize !== row.atomicGroupSize,
          ))
      ) {
        throw new Error("Local Folder reorder replica group is incomplete.");
      }
      if (selected.length + batch.length > PUSH_BATCH_SIZE) {
        if (selected.length === 0) {
          throw new Error("Local Folder reorder replica group exceeds the sync batch limit.");
        }
        break;
      }
      for (const member of batch) {
        if (selectedKeys.has(member.key)) continue;
        selectedKeys.add(member.key);
        selected.push(member);
      }
      if (selected.length === PUSH_BATCH_SIZE) break;
    }
    return selected.map((row) => ({
      operationId: row.operationId,
      baseRevision: row.revision,
      entity: row.entity,
      ...(row.atomicGroupId === undefined
        ? {}
        : {
            atomicGroupId: row.atomicGroupId,
            atomicGroupSize: row.atomicGroupSize,
          }),
    }));
  }

  private async recordPushResults(
    config: CollectionReplicaConfig,
    mutations: readonly ReplicaMutation[],
    results: readonly ReplicaPushResult[],
  ): Promise<void> {
    const byId = new Map(results.map((result) => [result.operationId, result]));
    if (
      results.length !== mutations.length ||
      byId.size !== mutations.length ||
      mutations.some((mutation) => !byId.has(mutation.operationId)) ||
      results.some(
        (result) =>
          !Number.isSafeInteger(result.revision) ||
          result.revision < 1 ||
          (result.status !== "accepted" && result.status !== "conflict"),
      )
    ) {
      throw new Error("Convex returned an invalid replica acknowledgement.");
    }
    const existing = new Map(
      (await this.outbox(config.configurationId)).map((row) => [row.key, row]),
    );
    const transaction = this.transaction([Stores.REPLICA_OUTBOX], "readwrite");
    const store = transaction.objectStore(Stores.REPLICA_OUTBOX);
    for (const mutation of mutations) {
      const result = byId.get(mutation.operationId);
      if (!result) continue;
      const row = existing.get(mutation.entity.key);
      if (!row || row.operationId !== mutation.operationId) continue;
      store.put({
        ...row,
        revision: result.revision,
        state: result.status === "accepted" ? "accepted" : "conflict",
      } satisfies OutboxRow);
    }
    await transactionDone(transaction);
  }

  private applyEntity(transaction: IDBTransaction, entity: ReplicaEntity): void {
    switch (entity.kind) {
      case "folder": {
        const store = transaction.objectStore(Stores.FOLDERS);
        if (entity.value === null) store.delete(entity.folderId);
        else store.put(entity.value);
        return;
      }
      case "saved-post": {
        const store = transaction.objectStore(Stores.SAVED_POSTS);
        if (entity.value === null) store.delete(entity.statusId);
        else store.put(entity.value);
        return;
      }
      case "folder-membership": {
        const store = transaction.objectStore(Stores.FOLDER_MEMBERSHIPS);
        if (entity.value === null) store.delete([entity.folderId, entity.statusId]);
        else store.put(entity.value);
        return;
      }
      case "bookmark-evidence": {
        const store = transaction.objectStore(Stores.BOOKMARK_EVIDENCE);
        if (entity.value === null) store.delete([entity.statusId, entity.xAccountId]);
        else store.put(entity.value);
      }
    }
  }

  private async currentEntity(
    transaction: IDBTransaction,
    entity: ReplicaEntity,
  ): Promise<ReplicaEntity> {
    switch (entity.kind) {
      case "folder": {
        const value = (await requestValue(
          transaction.objectStore(Stores.FOLDERS).get(entity.folderId),
        )) as Folder | undefined;
        return folderEntity(value ?? null, entity.folderId);
      }
      case "saved-post": {
        const value = (await requestValue(
          transaction.objectStore(Stores.SAVED_POSTS).get(entity.statusId),
        )) as SavedPost | undefined;
        return savedPostEntity(value ?? null, entity.statusId);
      }
      case "folder-membership": {
        const value = (await requestValue(
          transaction
            .objectStore(Stores.FOLDER_MEMBERSHIPS)
            .get([entity.folderId, entity.statusId]),
        )) as FolderMembership | undefined;
        return membershipEntity(value ?? null, entity.folderId, entity.statusId);
      }
      case "bookmark-evidence": {
        const value = (await requestValue(
          transaction
            .objectStore(Stores.BOOKMARK_EVIDENCE)
            .get([entity.statusId, entity.xAccountId]),
        )) as BookmarkEvidence | undefined;
        return evidenceEntity(value ?? null, entity.statusId, entity.xAccountId);
      }
    }
  }

  private async applyRemoteChanges(
    config: CollectionReplicaConfig,
    changes: readonly ReplicaChange[],
    cursor: number,
    nextCursor: number,
    signal?: AbortSignal,
  ): Promise<void> {
    let previous = cursor;
    for (const change of changes) {
      if (!Number.isSafeInteger(change.revision) || change.revision <= previous) {
        throw new Error("Convex returned an unordered replica change stream.");
      }
      previous = change.revision;
    }
    const before = new Map(
      (await this.outbox(config.configurationId)).map((row) => [row.key, row]),
    );
    const status = await this.statusRow(config);
    const transaction = this.transaction(
      [
        Stores.FOLDERS,
        Stores.SAVED_POSTS,
        Stores.FOLDER_MEMBERSHIPS,
        Stores.BOOKMARK_EVIDENCE,
        Stores.REPLICA_ENTITY_STATE,
        Stores.REPLICA_OUTBOX,
        Stores.REPLICA_STATUS,
      ],
      "readwrite",
    );
    const completed = transactionDone(transaction);
    const cancel = () => {
      try {
        transaction.abort();
      } catch {
        // The transaction already settled; the cancellation checks still fence later commits.
      }
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const states = transaction.objectStore(Stores.REPLICA_ENTITY_STATE);
    const outbox = transaction.objectStore(Stores.REPLICA_OUTBOX);
    try {
      if (signal?.aborted) cancel();
      const localChanges = new Set<string>();
      for (const change of changes) {
        const [current, state] = await Promise.all([
          this.currentEntity(transaction, change.entity),
          requestValue(states.get([config.configurationId, change.entity.key])) as Promise<
            EntityStateRow | undefined
          >,
        ]);
        if (
          state === undefined ? current.value !== null : fingerprint(current) !== state.fingerprint
        ) {
          localChanges.add(change.entity.key);
        }
      }
      if (signal?.aborted) cancel();
      transaction.objectStore(Stores.REPLICA_STATUS).put({
        ...(status ?? { configurationId: config.configurationId, ...LOCAL_ONLY }),
        cursor: nextCursor,
      } satisfies StatusRow);
      for (const change of changes) {
        if (!localChanges.has(change.entity.key)) this.applyEntity(transaction, change.entity);
        states.put({
          configurationId: config.configurationId,
          key: change.entity.key,
          entity: change.entity,
          fingerprint: fingerprint(change.entity),
          revision: change.revision,
        } satisfies EntityStateRow);
        const pending = before.get(change.entity.key);
        if (pending?.operationId === change.operationId && pending.state === "accepted") {
          outbox.delete([config.configurationId, change.entity.key]);
        }
      }
      await completed;
    } catch (error) {
      if (signal?.aborted) throw new ReplicaSyncCancelled();
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  private async conflictCount(config: CollectionReplicaConfig): Promise<number> {
    return (await this.outbox(config.configurationId)).filter((row) => row.state === "conflict")
      .length;
  }

  private async statusRow(config: CollectionReplicaConfig): Promise<StatusRow | undefined> {
    const transaction = this.transaction([Stores.REPLICA_STATUS], "readonly");
    const row = (await requestValue(
      transaction.objectStore(Stores.REPLICA_STATUS).get(config.configurationId),
    )) as StatusRow | undefined;
    await transactionDone(transaction);
    return row;
  }

  private async setStatus(
    config: CollectionReplicaConfig,
    status: CollectionReplicaStatus,
  ): Promise<CollectionReplicaStatus> {
    const previous = await this.statusRow(config);
    const row: StatusRow = {
      configurationId: config.configurationId,
      cursor: previous?.cursor ?? 0,
      ...status,
    };
    const transaction = this.transaction([Stores.REPLICA_STATUS], "readwrite");
    transaction.objectStore(Stores.REPLICA_STATUS).put(row);
    await transactionDone(transaction);
    return cloneStatus(status);
  }

  async status(config: CollectionReplicaConfig): Promise<CollectionReplicaStatus> {
    const row = await this.statusRow(config);
    return row ? cloneStatus(row) : cloneStatus(LOCAL_ONLY);
  }

  async synchronize(
    config: CollectionReplicaConfig,
    remote: CollectionReplicaRemote,
    signal?: AbortSignal,
  ): Promise<CollectionReplicaStatus> {
    if (signal?.aborted) return cloneStatus(LOCAL_ONLY);
    await this.setStatus(config, {
      state: "syncing",
      updatedAt: now(),
      error: null,
      conflicts: await this.conflictCount(config),
    });
    try {
      await this.prepareOutbox(config);
      for (;;) {
        const mutations = await this.pendingMutations(config);
        if (mutations.length === 0) break;
        if (signal?.aborted) throw new ReplicaSyncCancelled();
        const acknowledgement = await remote.push(mutations);
        if (signal?.aborted) throw new ReplicaSyncCancelled();
        await this.recordPushResults(config, mutations, acknowledgement.results);
      }

      let cursor = (await this.statusRow(config))?.cursor ?? 0;
      for (;;) {
        if (signal?.aborted) throw new ReplicaSyncCancelled();
        const page = await remote.pull({ cursor, limit: PULL_PAGE_SIZE });
        if (signal?.aborted) throw new ReplicaSyncCancelled();
        if (!Number.isSafeInteger(page.cursor) || page.cursor < cursor) {
          throw new Error("Convex returned an invalid replica cursor.");
        }
        const deliveredCursor = page.changes.at(-1)?.revision;
        if (
          (deliveredCursor === undefined && page.cursor !== cursor) ||
          (deliveredCursor !== undefined && page.cursor !== deliveredCursor)
        ) {
          throw new Error("Convex returned an inconsistent replica cursor.");
        }
        if (!page.done && page.cursor === cursor && page.changes.length === 0) {
          throw new Error("Convex returned a stalled replica change stream.");
        }
        await this.applyRemoteChanges(config, page.changes, cursor, page.cursor, signal);
        cursor = page.cursor;
        if (page.done) break;
      }

      if (signal?.aborted) throw new ReplicaSyncCancelled();
      const conflicts = await this.conflictCount(config);
      return this.setStatus(config, {
        state: conflicts === 0 ? "current" : "conflict",
        updatedAt: now(),
        error: null,
        conflicts,
      });
    } catch (error) {
      if (error instanceof ReplicaSyncCancelled) return cloneStatus(LOCAL_ONLY);
      const message = error instanceof Error ? error.message : "Could not synchronize Folders.";
      return this.setStatus(config, {
        state: error instanceof TypeError ? "offline" : "failed",
        updatedAt: now(),
        error: message.slice(0, MAX_ERROR_LENGTH),
        conflicts: await this.conflictCount(config),
      });
    }
  }
}
