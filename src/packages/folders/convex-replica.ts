import type {
  CollectionReplicaRemote,
  ReplicaChange,
  ReplicaEntity,
  ReplicaMutation,
  ReplicaPullResponse,
  ReplicaPushResponse,
  ReplicaPushResult,
} from "./replica";
import type { BookmarkEvidence, Folder, FolderMembership, SavedPost } from "./types";

/** The two Convex calls needed by the Folder replica seam. */
export interface ConvexReplicaCalls {
  mutation(ref: unknown, args: Record<string, unknown>): Promise<unknown>;
  query(ref: unknown, args: Record<string, unknown>): Promise<unknown>;
}

/** Opaque generated function references; only replica-client sees Convex codegen. */
export interface ConvexReplicaApiRefs {
  push: unknown;
  pull: unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isIdentifier(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function author(value: unknown): SavedPost["author"] | undefined {
  if (
    !record(value) ||
    !hasExactKeys(value, ["screenName"], ["userId"]) ||
    !isIdentifier(value.screenName) ||
    (Object.hasOwn(value, "userId") && !isIdentifier(value.userId))
  ) {
    return undefined;
  }
  return typeof value.userId === "string"
    ? { screenName: value.screenName, userId: value.userId }
    : { screenName: value.screenName };
}

function media(value: unknown): SavedPost["media"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: SavedPost["media"] = [];
  for (const item of value) {
    if (
      !record(item) ||
      !hasExactKeys(item, ["kind"], ["url"]) ||
      (item.kind !== "photo" && item.kind !== "video") ||
      (Object.hasOwn(item, "url") && !isString(item.url))
    ) {
      return undefined;
    }
    parsed.push(
      typeof item.url === "string" ? { kind: item.kind, url: item.url } : { kind: item.kind },
    );
  }
  return parsed;
}

function folder(value: unknown): Folder | null | undefined {
  if (value === null) return null;
  if (
    !record(value) ||
    !hasExactKeys(value, [
      "folderId",
      "name",
      "sortIndex",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ]) ||
    !isIdentifier(value.folderId) ||
    !isString(value.name) ||
    !isRevision(value.sortIndex) ||
    !isRevision(value.createdAt) ||
    !isRevision(value.updatedAt) ||
    !(value.deletedAt === null || isRevision(value.deletedAt))
  ) {
    return undefined;
  }
  return {
    folderId: value.folderId,
    name: value.name,
    sortIndex: value.sortIndex,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
  };
}

function savedPost(value: unknown): SavedPost | null | undefined {
  if (value === null) return null;
  if (
    !record(value) ||
    !hasExactKeys(
      value,
      ["statusId", "permalink", "media", "capturedAt", "note", "tags"],
      ["author", "text", "postedAt"],
    ) ||
    !isIdentifier(value.statusId) ||
    !nullableString(value.permalink) ||
    !isRevision(value.capturedAt) ||
    !isString(value.note) ||
    !Array.isArray(value.tags) ||
    !value.tags.every(isString)
  ) {
    return undefined;
  }
  const parsedMedia = media(value.media);
  if (parsedMedia === undefined) return undefined;
  const parsed: SavedPost = {
    statusId: value.statusId,
    permalink: value.permalink,
    media: parsedMedia,
    capturedAt: value.capturedAt,
    note: value.note,
    tags: [...value.tags],
  };
  if (Object.hasOwn(value, "author")) {
    const parsedAuthor = author(value.author);
    if (parsedAuthor === undefined) return undefined;
    parsed.author = parsedAuthor;
  }
  if (Object.hasOwn(value, "text")) {
    if (!isString(value.text)) return undefined;
    parsed.text = value.text;
  }
  if (Object.hasOwn(value, "postedAt")) {
    if (!isString(value.postedAt)) return undefined;
    parsed.postedAt = value.postedAt;
  }
  return parsed;
}

function membership(value: unknown): FolderMembership | null | undefined {
  if (value === null) return null;
  if (
    !record(value) ||
    !hasExactKeys(value, ["folderId", "statusId", "addedAt"]) ||
    !isIdentifier(value.folderId) ||
    !isIdentifier(value.statusId) ||
    !isRevision(value.addedAt)
  ) {
    return undefined;
  }
  return {
    folderId: value.folderId,
    statusId: value.statusId,
    addedAt: value.addedAt,
  };
}

function evidence(value: unknown): BookmarkEvidence | null | undefined {
  if (value === null) return null;
  if (
    !record(value) ||
    !hasExactKeys(value, ["statusId", "xAccountId", "outcome", "observedAt"]) ||
    !isIdentifier(value.statusId) ||
    !isIdentifier(value.xAccountId) ||
    (value.outcome !== "confirmed" && value.outcome !== "failed" && value.outcome !== "skipped") ||
    !isRevision(value.observedAt)
  ) {
    return undefined;
  }
  return {
    statusId: value.statusId,
    xAccountId: value.xAccountId,
    outcome: value.outcome,
    observedAt: value.observedAt,
  };
}

function replicaEntity(value: unknown): ReplicaEntity | undefined {
  if (!record(value) || !isString(value.kind) || !isIdentifier(value.key)) return undefined;
  switch (value.kind) {
    case "folder": {
      if (
        !hasExactKeys(value, ["kind", "key", "folderId", "value"]) ||
        !isIdentifier(value.folderId) ||
        value.key !== JSON.stringify(["folder", value.folderId])
      ) {
        return undefined;
      }
      const parsed = folder(value.value);
      if (parsed === undefined || (parsed !== null && parsed.folderId !== value.folderId))
        return undefined;
      return {
        kind: "folder",
        key: value.key,
        folderId: value.folderId,
        value: parsed,
      };
    }
    case "saved-post": {
      if (
        !hasExactKeys(value, ["kind", "key", "statusId", "value"]) ||
        !isIdentifier(value.statusId) ||
        value.key !== JSON.stringify(["saved-post", value.statusId])
      ) {
        return undefined;
      }
      const parsed = savedPost(value.value);
      if (parsed === undefined || (parsed !== null && parsed.statusId !== value.statusId))
        return undefined;
      return {
        kind: "saved-post",
        key: value.key,
        statusId: value.statusId,
        value: parsed,
      };
    }
    case "folder-membership": {
      if (
        !hasExactKeys(value, ["kind", "key", "folderId", "statusId", "value"]) ||
        !isIdentifier(value.folderId) ||
        !isIdentifier(value.statusId) ||
        value.key !== JSON.stringify(["folder-membership", value.folderId, value.statusId])
      ) {
        return undefined;
      }
      const parsed = membership(value.value);
      if (
        parsed === undefined ||
        (parsed !== null &&
          (parsed.folderId !== value.folderId || parsed.statusId !== value.statusId))
      ) {
        return undefined;
      }
      return {
        kind: "folder-membership",
        key: value.key,
        folderId: value.folderId,
        statusId: value.statusId,
        value: parsed,
      };
    }
    case "bookmark-evidence": {
      if (
        !hasExactKeys(value, ["kind", "key", "statusId", "xAccountId", "value"]) ||
        !isIdentifier(value.statusId) ||
        !isIdentifier(value.xAccountId) ||
        value.key !== JSON.stringify(["bookmark-evidence", value.statusId, value.xAccountId])
      ) {
        return undefined;
      }
      const parsed = evidence(value.value);
      if (
        parsed === undefined ||
        (parsed !== null &&
          (parsed.statusId !== value.statusId || parsed.xAccountId !== value.xAccountId))
      ) {
        return undefined;
      }
      return {
        kind: "bookmark-evidence",
        key: value.key,
        statusId: value.statusId,
        xAccountId: value.xAccountId,
        value: parsed,
      };
    }
    default:
      return undefined;
  }
}

function atomicGroup(
  value: Record<string, unknown>,
): Pick<ReplicaMutation, "atomicGroupId" | "atomicGroupSize"> | undefined {
  const hasId = Object.hasOwn(value, "atomicGroupId");
  const hasSize = Object.hasOwn(value, "atomicGroupSize");
  if (!hasId && !hasSize) return {};
  if (
    !hasId ||
    !hasSize ||
    !isIdentifier(value.atomicGroupId) ||
    !isRevision(value.atomicGroupSize) ||
    value.atomicGroupSize < 2 ||
    value.atomicGroupSize > 256
  ) {
    return undefined;
  }
  return {
    atomicGroupId: value.atomicGroupId,
    atomicGroupSize: value.atomicGroupSize,
  };
}

function replicaChange(value: unknown): ReplicaChange | undefined {
  if (
    !record(value) ||
    !hasExactKeys(
      value,
      ["operationId", "baseRevision", "entity", "revision"],
      ["atomicGroupId", "atomicGroupSize"],
    ) ||
    !isIdentifier(value.operationId) ||
    !isRevision(value.baseRevision) ||
    !isRevision(value.revision) ||
    value.revision === 0
  ) {
    return undefined;
  }
  const entity = replicaEntity(value.entity);
  const group = atomicGroup(value);
  if (entity === undefined || group === undefined) return undefined;
  return {
    operationId: value.operationId,
    baseRevision: value.baseRevision,
    entity,
    revision: value.revision,
    ...group,
  };
}

function pushResult(value: unknown): ReplicaPushResponse {
  if (!record(value) || !hasExactKeys(value, ["results"]) || !Array.isArray(value.results)) {
    throw new Error("Invalid Convex Folder replica push response.");
  }
  const results: ReplicaPushResult[] = [];
  for (const result of value.results) {
    if (
      !record(result) ||
      !hasExactKeys(result, ["operationId", "status", "revision"]) ||
      !isString(result.operationId) ||
      (result.status !== "accepted" && result.status !== "conflict") ||
      !isRevision(result.revision)
    ) {
      throw new Error("Invalid Convex Folder replica push response.");
    }
    results.push({
      operationId: result.operationId,
      status: result.status,
      revision: result.revision,
    });
  }
  return { results };
}

function pullResult(value: unknown): ReplicaPullResponse {
  if (
    !record(value) ||
    !hasExactKeys(value, ["changes", "cursor", "done"]) ||
    !Array.isArray(value.changes) ||
    !isRevision(value.cursor) ||
    typeof value.done !== "boolean"
  ) {
    throw new Error("Invalid Convex Folder replica pull response.");
  }
  const changes: ReplicaChange[] = [];
  for (const change of value.changes) {
    const parsed = replicaChange(change);
    if (parsed === undefined) {
      throw new Error("Invalid Convex Folder replica pull response.");
    }
    changes.push(parsed);
  }
  return { changes, cursor: value.cursor, done: value.done };
}

/**
 * Bounds one Convex call. A hung endpoint must fail the SYNC, not the worker:
 * Chrome kills an MV3 service worker that waits on a blackholed fetch, and
 * every message awaiting that worker then resolves empty — which surfaces
 * report as "Invalid collections response". The rejection is a TypeError so
 * the replica store records "offline", the state that promises a retry,
 * rather than "failed", which asks the user to act.
 */
export function boundedReplicaCalls(
  calls: ConvexReplicaCalls,
  timeoutMs: number,
): ConvexReplicaCalls {
  const bound = <T>(call: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new TypeError("Convex Folder replica did not answer in time.")),
        timeoutMs,
      );
    });
    // The loser of the race keeps running — a late answer is simply ignored —
    // but its timer is cleared so the worker can idle out on schedule.
    return Promise.race([call, expired]).finally(() => clearTimeout(timer));
  };
  return {
    mutation: (ref, args) => bound(calls.mutation(ref, args)),
    query: (ref, args) => bound(calls.query(ref, args)),
  };
}

/**
 * A small HTTP adapter. It stamps the device key on each call but never sends
 * it through the local Folder store, replica metadata, or UI response shapes.
 */
export class ConvexFolderReplica implements CollectionReplicaRemote {
  constructor(
    private readonly calls: ConvexReplicaCalls,
    private readonly api: ConvexReplicaApiRefs,
    private readonly deviceKey: string,
  ) {}

  async push(mutations: readonly ReplicaMutation[]): Promise<ReplicaPushResponse> {
    return pushResult(
      await this.calls.mutation(this.api.push, {
        deviceKey: this.deviceKey,
        mutations,
      }),
    );
  }

  async pull({ cursor, limit }: { cursor: number; limit: number }): Promise<ReplicaPullResponse> {
    return pullResult(
      await this.calls.query(this.api.pull, {
        deviceKey: this.deviceKey,
        cursor,
        limit,
      }),
    );
  }
}
