import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { createDataLifecycle } from "@/background/data-lifecycle";
import type { CacheObservation } from "@/core/cache-observation";
import type { CollectionsRequest } from "@/core/protocol/collections";
import { createCollectionStore } from "@/packages/folders";
import type {
  CollectionReplicaRemote,
  ReplicaChange,
  ReplicaMutation,
} from "@/packages/folders/replica";

import { createMemoryArea } from "../helpers/chrome-fake";

const TYPE = "lasso:collections";
const CONVEX_URL = "https://shared.convex.cloud";
const DEVICE_KEY = "shared-device-key";

class InMemoryReplica implements CollectionReplicaRemote {
  private revision = 0;
  private readonly changes: ReplicaChange[] = [];
  readonly pushed: ReplicaMutation[][] = [];

  async push(mutations: readonly ReplicaMutation[]) {
    this.pushed.push(structuredClone([...mutations]));
    return {
      results: mutations.map((mutation) => {
        const revision = ++this.revision;
        this.changes.push({ ...structuredClone(mutation), revision });
        return { operationId: mutation.operationId, status: "accepted" as const, revision };
      }),
    };
  }

  async pull({ cursor, limit }: { cursor: number; limit: number }) {
    const changes = this.changes
      .filter((change) => change.revision > cursor)
      .slice(0, Math.min(limit, 1));
    const last = changes.at(-1)?.revision ?? cursor;
    return {
      changes: structuredClone(changes),
      cursor: last,
      done: changes.length === 0 || last === this.revision,
    };
  }
}

function worker(replica: CollectionReplicaRemote) {
  const local = createMemoryArea();
  const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "shared-config", {
    open: async () => createCollectionStore({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange }),
    replica: () => replica,
  });
  const run = (request: CollectionsRequest) => lifecycle.collections(request);
  const token = async (): Promise<CacheObservation> => {
    const response = await run({ type: TYPE, operation: "begin" });
    return (response as { token: CacheObservation }).token;
  };
  return { lifecycle, run, token };
}

describe("Collections replica", () => {
  it("hydrates complete Saved Post information in another Chrome installation", async () => {
    const remote = new InMemoryReplica();
    const first = worker(remote);
    await first.lifecycle.patchSettings({ convexUrl: CONVEX_URL, convexDeviceKey: DEVICE_KEY });

    const createToken = await first.token();
    const created = await first.run({
      type: TYPE,
      operation: "create-folder",
      name: "Research",
      token: createToken,
    });
    const folder = (created as { folder: { folderId: string } }).folder;

    const saveToken = await first.token();
    await first.run({
      type: TYPE,
      operation: "save-post",
      folderId: folder.folderId,
      capture: {
        statusId: "1234567890",
        permalink: "https://x.com/jack/status/1234567890",
        author: { screenName: "jack", userId: "12" },
        text: "A durable capture",
        media: [{ kind: "photo", url: "https://pbs.twimg.com/media/a.jpg" }],
        postedAt: "2026-08-02T00:00:00.000Z",
      },
      token: saveToken,
    });
    const noteToken = await first.token();
    await first.run({
      type: TYPE,
      operation: "set-note",
      statusId: "1234567890",
      note: "Read this later",
      token: noteToken,
    });
    const tagsToken = await first.token();
    await first.run({
      type: TYPE,
      operation: "set-tags",
      statusId: "1234567890",
      tags: ["research", "convex"],
      token: tagsToken,
    });
    const evidenceToken = await first.token();
    await first.run({
      type: TYPE,
      operation: "record-bookmark-evidence",
      statusId: "1234567890",
      xAccountId: "account-1",
      outcome: "confirmed",
      observedAt: 20,
      token: evidenceToken,
    });

    await first.run({ type: TYPE, operation: "sync-now" });

    const second = worker(remote);
    await second.lifecycle.patchSettings({ convexUrl: CONVEX_URL, convexDeviceKey: DEVICE_KEY });
    await second.run({ type: TYPE, operation: "sync-now" });

    await expect(
      second.run({ type: TYPE, operation: "list-folders", includeDeleted: false }),
    ).resolves.toEqual({
      folders: [
        expect.objectContaining({ folderId: folder.folderId, name: "Research", deletedAt: null }),
      ],
    });
    await expect(
      second.run({
        type: TYPE,
        operation: "read-folder-page",
        folderId: folder.folderId,
        limit: 25,
        cursor: null,
      }),
    ).resolves.toEqual({
      page: {
        posts: [
          {
            statusId: "1234567890",
            permalink: "https://x.com/jack/status/1234567890",
            author: { screenName: "jack", userId: "12" },
            text: "A durable capture",
            media: [{ kind: "photo", url: "https://pbs.twimg.com/media/a.jpg" }],
            postedAt: "2026-08-02T00:00:00.000Z",
            capturedAt: expect.any(Number),
            note: "Read this later",
            tags: ["research", "convex"],
          },
        ],
        nextCursor: null,
      },
    });
    await expect(
      second.run({ type: TYPE, operation: "list-bookmark-evidence", statusId: "1234567890" }),
    ).resolves.toEqual({
      evidence: [
        {
          statusId: "1234567890",
          xAccountId: "account-1",
          outcome: "confirmed",
          observedAt: 20,
        },
      ],
    });
  });

  it("uploads a Folder reorder as one complete atomic group", async () => {
    const remote = new InMemoryReplica();
    const installation = worker(remote);
    await installation.lifecycle.patchSettings({
      convexUrl: CONVEX_URL,
      convexDeviceKey: DEVICE_KEY,
    });
    const createFolder = async (name: string): Promise<string> => {
      const token = await installation.token();
      const response = await installation.run({
        type: TYPE,
        operation: "create-folder",
        name,
        token,
      });
      return (response as { folder: { folderId: string } }).folder.folderId;
    };
    const first = await createFolder("First");
    const second = await createFolder("Second");
    const third = await createFolder("Third");
    await installation.run({ type: TYPE, operation: "sync-now" });
    remote.pushed.length = 0;

    const token = await installation.token();
    await installation.run({
      type: TYPE,
      operation: "reorder-folders",
      folderIds: [third, second, first],
      token,
    });
    await installation.run({ type: TYPE, operation: "sync-now" });

    const reordered = remote.pushed
      .flat()
      .filter((mutation) => mutation.atomicGroupId !== undefined);
    expect(reordered).toHaveLength(3);
    expect(new Set(reordered.map((mutation) => mutation.atomicGroupId)).size).toBe(1);
    expect(new Set(reordered.map((mutation) => mutation.atomicGroupSize))).toEqual(new Set([3]));
    expect(
      new Set(
        reordered.map((mutation) =>
          mutation.entity.kind === "folder" ? mutation.entity.folderId : null,
        ),
      ),
    ).toEqual(new Set([first, second, third]));
  });

  it("reports a stale local mutation without retrying it forever", async () => {
    const remote: CollectionReplicaRemote = {
      push: async (mutations) => ({
        results: mutations.map((mutation) => ({
          operationId: mutation.operationId,
          status: "conflict" as const,
          revision: 1,
        })),
      }),
      pull: async ({ cursor }) => ({ changes: [], cursor, done: true }),
    };
    const installation = worker(remote);
    await installation.lifecycle.patchSettings({
      convexUrl: CONVEX_URL,
      convexDeviceKey: DEVICE_KEY,
    });
    const token = await installation.token();
    await installation.run({
      type: TYPE,
      operation: "create-folder",
      name: "Local only",
      token,
    });

    await expect(installation.run({ type: TYPE, operation: "sync-now" })).resolves.toEqual({
      replicaStatus: expect.objectContaining({
        state: "conflict",
        error: null,
        conflicts: 1,
      }),
    });
    await expect(installation.run({ type: TYPE, operation: "replica-status" })).resolves.toEqual({
      replicaStatus: expect.objectContaining({ state: "conflict", conflicts: 1 }),
    });
  });

  it("stays local-only until both Convex settings are configured", async () => {
    const push = vi.fn<CollectionReplicaRemote["push"]>();
    const remote: CollectionReplicaRemote = {
      push,
      pull: async ({ cursor }) => ({ changes: [], cursor, done: true }),
    };
    const installation = worker(remote);
    await installation.lifecycle.patchSettings({
      convexUrl: undefined,
      convexDeviceKey: undefined,
    });
    const token = await installation.token();
    await installation.run({
      type: TYPE,
      operation: "create-folder",
      name: "Offline",
      token,
    });

    await expect(installation.run({ type: TYPE, operation: "sync-now" })).resolves.toEqual({
      replicaStatus: { state: "local-only", updatedAt: null, error: null, conflicts: 0 },
    });
    expect(push).not.toHaveBeenCalled();
  });
});
