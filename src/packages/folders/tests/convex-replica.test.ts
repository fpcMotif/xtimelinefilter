import { describe, expect, it, vi } from "vitest";

import {
  ConvexFolderReplica,
  type ConvexReplicaApiRefs,
  type ConvexReplicaCalls,
} from "../convex-replica";
import type { ReplicaChange, ReplicaMutation } from "../replica";

const mutation: ReplicaMutation = {
  operationId: "operation-1",
  baseRevision: 0,
  entity: {
    kind: "folder",
    key: '["folder","fld_00000000000000000001"]',
    folderId: "fld_00000000000000000001",
    value: {
      folderId: "fld_00000000000000000001",
      name: "Research",
      sortIndex: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    },
  },
};

const change: ReplicaChange = { ...mutation, revision: 1 };

const api: ConvexReplicaApiRefs = { push: "folderReplica.push", pull: "folderReplica.pull" };

describe("ConvexFolderReplica", () => {
  it("stamps the device key onto bounded push and pull calls without persisting it", async () => {
    const calls: ConvexReplicaCalls = {
      mutation: vi.fn(async () => ({
        results: [{ operationId: mutation.operationId, status: "accepted" as const, revision: 1 }],
      })),
      query: vi.fn(async () => ({ changes: [change], cursor: 1, done: true })),
    };
    const replica = new ConvexFolderReplica(calls, api, "device-key");

    await expect(replica.push([mutation])).resolves.toEqual({
      results: [{ operationId: mutation.operationId, status: "accepted", revision: 1 }],
    });
    await expect(replica.pull({ cursor: 0, limit: 100 })).resolves.toEqual({
      changes: [change],
      cursor: 1,
      done: true,
    });
    expect(calls.mutation).toHaveBeenCalledWith(api.push, {
      deviceKey: "device-key",
      mutations: [mutation],
    });
    expect(calls.query).toHaveBeenCalledWith(api.pull, {
      deviceKey: "device-key",
      cursor: 0,
      limit: 100,
    });
  });

  it("rejects malformed pull entities before they reach local replica storage", async () => {
    const calls: ConvexReplicaCalls = {
      mutation: vi.fn(async () => ({ results: [] })),
      query: vi.fn(async () => ({
        changes: [
          {
            operationId: "operation-1",
            baseRevision: 0,
            revision: 1,
            entity: { kind: "folder", key: "not-a-folder-key", value: null },
          },
        ],
        cursor: 1,
        done: true,
      })),
    };
    const replica = new ConvexFolderReplica(calls, api, "device-key");

    await expect(replica.pull({ cursor: 0, limit: 100 })).rejects.toThrow(
      "Invalid Convex Folder replica pull response.",
    );
  });
});
