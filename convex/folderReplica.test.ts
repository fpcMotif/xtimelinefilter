// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { MAX_REPLICA_MUTATIONS } from "./folderReplica";
import schema from "./schema";

declare const process: { env: Record<string, string | undefined> };
declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

const DEVICE_KEY = "replica-test-device-key";
const modules = import.meta.glob("./**/*.*s");

function folderValue(
  folderId: string,
  name = "Inbox",
): {
  folderId: string;
  name: string;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
} {
  return {
    folderId,
    name,
    sortIndex: 0,
    createdAt: 10,
    updatedAt: 10,
    deletedAt: null,
  };
}

function folderEntity(folderId: string, value = folderValue(folderId)) {
  return {
    kind: "folder" as const,
    key: JSON.stringify(["folder", folderId]),
    folderId,
    value,
  };
}

function savedPostEntity(statusId: string) {
  return {
    kind: "saved-post" as const,
    key: JSON.stringify(["saved-post", statusId]),
    statusId,
    value: {
      statusId,
      permalink: "https://x.example/post/1",
      author: { screenName: "author", userId: "author-1" },
      text: "durable capture",
      media: [],
      capturedAt: 11,
      note: "",
      tags: [],
    },
  };
}

beforeEach(() => {
  process.env.LASSO_DEVICE_KEY = DEVICE_KEY;
});

afterEach(() => {
  delete process.env.LASSO_DEVICE_KEY;
});

describe("Folder replica", () => {
  test("rejects an invalid device key before writing replica data", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: "wrong-key",
        mutations: [
          {
            operationId: "op-1",
            baseRevision: 0,
            entity: folderEntity("folder-1"),
          },
        ],
      }),
    ).rejects.toThrow("Unauthorized: invalid device key");

    await expect(
      t.query(api.folderReplica.pull, {
        deviceKey: "wrong-key",
        cursor: 0,
        limit: 1,
      }),
    ).rejects.toThrow("Unauthorized: invalid device key");

    await expect(
      t.run(async (ctx) => ({
        entities: await ctx.db.query("folderReplicaEntities").collect(),
        changes: await ctx.db.query("folderReplicaChanges").collect(),
        receipts: await ctx.db.query("folderReplicaReceipts").collect(),
      })),
    ).resolves.toEqual({ entities: [], changes: [], receipts: [] });
  });

  test("deduplicates an operationId and returns its original receipt", async () => {
    const t = convexTest(schema, modules);
    const replicaMutation = {
      operationId: "folder-create",
      baseRevision: 0,
      entity: folderEntity("folder-1"),
    };

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [replicaMutation],
      }),
    ).resolves.toEqual({
      results: [{ operationId: "folder-create", status: "accepted", revision: 1 }],
    });
    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [replicaMutation],
      }),
    ).resolves.toEqual({
      results: [{ operationId: "folder-create", status: "accepted", revision: 1 }],
    });

    await expect(
      t.query(api.folderReplica.pull, {
        deviceKey: DEVICE_KEY,
        cursor: 0,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      cursor: 1,
      done: true,
      changes: [{ operationId: "folder-create", revision: 1 }],
    });
    await expect(
      t.run((ctx) => ctx.db.query("folderReplicaReceipts").collect()),
    ).resolves.toHaveLength(1);
  });

  test("hydrates the complete ordered change stream through bounded pages", async () => {
    const t = convexTest(schema, modules);
    const folderId = "folder-1";
    const statusId = "status-1";
    const changes = [
      {
        operationId: "folder",
        baseRevision: 0,
        entity: folderEntity(folderId),
      },
      {
        operationId: "post",
        baseRevision: 0,
        entity: savedPostEntity(statusId),
      },
      {
        operationId: "membership",
        baseRevision: 0,
        entity: {
          kind: "folder-membership" as const,
          key: JSON.stringify(["folder-membership", folderId, statusId]),
          folderId,
          statusId,
          value: { folderId, statusId, addedAt: 12 },
        },
      },
      {
        operationId: "evidence",
        baseRevision: 0,
        entity: {
          kind: "bookmark-evidence" as const,
          key: JSON.stringify(["bookmark-evidence", statusId, "x-account-1"]),
          statusId,
          xAccountId: "x-account-1",
          value: {
            statusId,
            xAccountId: "x-account-1",
            outcome: "confirmed" as const,
            observedAt: 13,
          },
        },
      },
    ];

    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: changes,
    });

    const first = await t.query(api.folderReplica.pull, {
      deviceKey: DEVICE_KEY,
      cursor: 0,
      limit: 2,
    });
    expect(first).toMatchObject({ cursor: 2, done: false });
    expect(first.changes.map((change) => change.revision)).toEqual([1, 2]);

    const second = await t.query(api.folderReplica.pull, {
      deviceKey: DEVICE_KEY,
      cursor: first.cursor,
      limit: 2,
    });
    expect(second).toMatchObject({ cursor: 4, done: true });
    expect(second.changes.map((change) => change.revision)).toEqual([3, 4]);
    expect([...first.changes, ...second.changes].map((change) => change.entity.key)).toEqual(
      changes.map((change) => change.entity.key),
    );
    await expect(
      t.query(api.folderReplica.pull, {
        deviceKey: DEVICE_KEY,
        cursor: second.cursor,
        limit: 2,
      }),
    ).resolves.toEqual({ changes: [], cursor: 4, done: true });
  });

  test("never splits an atomic Folder reorder at a pull page boundary", async () => {
    const t = convexTest(schema, modules);
    const folderIds = Array.from({ length: 101 }, (_, index) => `folder-${index}`);
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: folderIds.map((folderId, index) => ({
        operationId: `create-${index}`,
        baseRevision: 0,
        entity: folderEntity(folderId, folderValue(folderId, `Folder ${index}`)),
      })),
    });
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: folderIds.map((folderId, index) => ({
        operationId: `reorder-${index}`,
        baseRevision: index + 1,
        atomicGroupId: "reorder-101",
        atomicGroupSize: folderIds.length,
        entity: folderEntity(
          folderId,
          index === folderIds.length - 1
            ? folderValue(folderId, `Folder ${index}`)
            : {
                ...folderValue(folderId, `Folder ${index}`),
                sortIndex: folderIds.length - index - 1,
                updatedAt: 11,
              },
        ),
      })),
    });
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "after-reorder",
          baseRevision: 0,
          entity: savedPostEntity("status-after-reorder"),
        },
      ],
    });

    const creations = await t.query(api.folderReplica.pull, {
      deviceKey: DEVICE_KEY,
      cursor: 0,
      limit: 101,
    });
    const reorder = await t.query(api.folderReplica.pull, {
      deviceKey: DEVICE_KEY,
      cursor: creations.cursor,
      limit: 100,
    });

    expect(reorder.changes).toHaveLength(101);
    expect(new Set(reorder.changes.map((change) => change.atomicGroupId))).toEqual(
      new Set(["reorder-101"]),
    );
    expect(reorder).toMatchObject({ cursor: 202, done: false });
    await expect(
      t.query(api.folderReplica.pull, {
        deviceKey: DEVICE_KEY,
        cursor: reorder.cursor,
        limit: 100,
      }),
    ).resolves.toMatchObject({
      cursor: 203,
      done: true,
      changes: [{ operationId: "after-reorder" }],
    });
  });

  test("treats duplicate live Folder membership additions as an idempotent union", async () => {
    const t = convexTest(schema, modules);
    const folderId = "folder-1";
    const statusId = "status-1";
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "folder",
          baseRevision: 0,
          entity: folderEntity(folderId),
        },
        {
          operationId: "post",
          baseRevision: 0,
          entity: savedPostEntity(statusId),
        },
      ],
    });
    const membership = (operationId: string, addedAt: number) => ({
      operationId,
      baseRevision: 0,
      entity: {
        kind: "folder-membership" as const,
        key: JSON.stringify(["folder-membership", folderId, statusId]),
        folderId,
        statusId,
        value: { folderId, statusId, addedAt },
      },
    });

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [membership("membership-a", 12)],
      }),
    ).resolves.toEqual({
      results: [{ operationId: "membership-a", status: "accepted", revision: 3 }],
    });
    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [membership("membership-b", 20)],
      }),
    ).resolves.toEqual({
      results: [{ operationId: "membership-b", status: "accepted", revision: 3 }],
    });
    const page = await t.query(api.folderReplica.pull, {
      deviceKey: DEVICE_KEY,
      cursor: 0,
      limit: 10,
    });
    expect(page.changes.filter((change) => change.entity.kind === "folder-membership")).toEqual([
      expect.objectContaining({ operationId: "membership-a", revision: 3 }),
    ]);
  });

  test("rejects a Folder name beyond the local 100-code-point protocol limit", async () => {
    const t = convexTest(schema, modules);
    const folderId = "folder-too-long";

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "overlong-folder",
            baseRevision: 0,
            entity: folderEntity(folderId, folderValue(folderId, "a".repeat(101))),
          },
        ],
      }),
    ).rejects.toThrow("folder.name exceeds 100-code-point limit");
    await expect(t.run((ctx) => ctx.db.query("folderReplicaEntities").collect())).resolves.toEqual(
      [],
    );
  });

  test("keeps a tombstone and rejects stale resurrection", async () => {
    const t = convexTest(schema, modules);
    const folderId = "folder-1";

    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "create",
          baseRevision: 0,
          entity: folderEntity(folderId),
        },
      ],
    });
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "delete",
          baseRevision: 1,
          entity: {
            kind: "folder",
            key: JSON.stringify(["folder", folderId]),
            folderId,
            value: null,
          },
        },
      ],
    });

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "stale-recreate",
            baseRevision: 0,
            entity: folderEntity(folderId),
          },
        ],
      }),
    ).resolves.toEqual({
      results: [{ operationId: "stale-recreate", status: "conflict", revision: 2 }],
    });

    await expect(
      t.query(api.folderReplica.pull, {
        deviceKey: DEVICE_KEY,
        cursor: 0,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      cursor: 2,
      done: true,
      changes: [
        { operationId: "create", revision: 1 },
        {
          operationId: "delete",
          revision: 2,
          entity: { kind: "folder", value: null },
        },
      ],
    });
  });

  test("rejects foreign-key mismatches and future revisions before a partial batch writes", async () => {
    const t = convexTest(schema, modules);
    const folderId = "folder-1";
    const statusId = "status-1";

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "valid",
            baseRevision: 0,
            entity: folderEntity(folderId),
          },
          {
            operationId: "invalid-membership",
            baseRevision: 0,
            entity: {
              kind: "folder-membership",
              key: JSON.stringify(["folder-membership", folderId, statusId]),
              folderId,
              statusId,
              value: { folderId, statusId: "other-status", addedAt: 12 },
            },
          },
        ],
      }),
    ).rejects.toThrow("folder-membership value does not match foreign keys");
    await expect(t.run((ctx) => ctx.db.query("folderReplicaEntities").collect())).resolves.toEqual(
      [],
    );
    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "orphan-membership",
            baseRevision: 0,
            entity: {
              kind: "folder-membership",
              key: JSON.stringify(["folder-membership", folderId, statusId]),
              folderId,
              statusId,
              value: { folderId, statusId, addedAt: 12 },
            },
          },
        ],
      }),
    ).rejects.toThrow("folder-membership Folder references a missing or tombstoned record");
    await expect(t.run((ctx) => ctx.db.query("folderReplicaEntities").collect())).resolves.toEqual(
      [],
    );
    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "orphan-evidence",
            baseRevision: 0,
            entity: {
              kind: "bookmark-evidence",
              key: JSON.stringify(["bookmark-evidence", statusId, "x-account-1"]),
              statusId,
              xAccountId: "x-account-1",
              value: {
                statusId,
                xAccountId: "x-account-1",
                outcome: "confirmed",
                observedAt: 12,
              },
            },
          },
        ],
      }),
    ).rejects.toThrow("bookmark-evidence Saved Post references a missing or tombstoned record");
    await expect(t.run((ctx) => ctx.db.query("folderReplicaEntities").collect())).resolves.toEqual(
      [],
    );

    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "create",
          baseRevision: 0,
          entity: folderEntity(folderId),
        },
      ],
    });
    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "independent",
            baseRevision: 0,
            entity: folderEntity("folder-2"),
          },
          {
            operationId: "future",
            baseRevision: 2,
            entity: folderEntity(folderId, {
              ...folderValue(folderId),
              updatedAt: 11,
            }),
          },
        ],
      }),
    ).rejects.toThrow("baseRevision is ahead of the entity revision");
    const after = await t.run(async (ctx) => ({
      entities: await ctx.db.query("folderReplicaEntities").collect(),
      changes: await ctx.db.query("folderReplicaChanges").collect(),
    }));
    expect(after.entities).toHaveLength(1);
    expect(after.entities[0]).toMatchObject({ revision: 1 });
    expect(after.changes).toHaveLength(1);
  });
  test("merges only richer Saved Post capture and keeps the newest bookmark observation", async () => {
    const t = convexTest(schema, modules);
    const statusId = "status-1";
    const initialPost = savedPostEntity(statusId);
    const evidence = {
      kind: "bookmark-evidence" as const,
      key: JSON.stringify(["bookmark-evidence", statusId, "x-account-1"]),
      statusId,
      xAccountId: "x-account-1",
      value: {
        statusId,
        xAccountId: "x-account-1",
        outcome: "confirmed" as const,
        observedAt: 13,
      },
    };

    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        { operationId: "post-create", baseRevision: 0, entity: initialPost },
        { operationId: "evidence-create", baseRevision: 0, entity: evidence },
      ],
    });

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "post-enrich",
            baseRevision: 0,
            entity: {
              ...initialPost,
              value: {
                ...initialPost.value,
                media: [{ kind: "photo" as const, url: "https://x.example/photo/1" }],
              },
            },
          },
          {
            operationId: "evidence-newer",
            baseRevision: 0,
            entity: {
              ...evidence,
              value: { ...evidence.value, observedAt: 14 },
            },
          },
        ],
      }),
    ).resolves.toEqual({
      results: [
        { operationId: "post-enrich", status: "accepted", revision: 3 },
        { operationId: "evidence-newer", status: "accepted", revision: 4 },
      ],
    });

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "post-stale-note",
            baseRevision: 1,
            entity: {
              ...initialPost,
              value: { ...initialPost.value, note: "stale edit" },
            },
          },
          {
            operationId: "evidence-older",
            baseRevision: 0,
            entity: {
              ...evidence,
              value: { ...evidence.value, observedAt: 12 },
            },
          },
        ],
      }),
    ).resolves.toEqual({
      results: [
        { operationId: "post-stale-note", status: "conflict", revision: 3 },
        { operationId: "evidence-older", status: "accepted", revision: 4 },
      ],
    });

    const state = await t.run(async (ctx) => ({
      post: await ctx.db
        .query("folderReplicaEntities")
        .withIndex("by_key", (q) => q.eq("key", initialPost.key))
        .unique(),
      evidence: await ctx.db
        .query("folderReplicaEntities")
        .withIndex("by_key", (q) => q.eq("key", evidence.key))
        .unique(),
    }));
    expect(state.post?.entity).toMatchObject({
      kind: "saved-post",
      value: { media: [{ kind: "photo", url: "https://x.example/photo/1" }] },
    });
    expect(state.evidence?.entity).toMatchObject({
      kind: "bookmark-evidence",
      value: { observedAt: 14 },
    });
  });

  test("stores only account-free collection state and bookmark evidence", async () => {
    const t = convexTest(schema, modules);
    const folderId = "folder-1";
    const statusId = "status-1";

    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "folder",
          baseRevision: 0,
          entity: folderEntity(folderId),
        },
        {
          operationId: "post",
          baseRevision: 0,
          entity: savedPostEntity(statusId),
        },
        {
          operationId: "membership",
          baseRevision: 0,
          entity: {
            kind: "folder-membership" as const,
            key: JSON.stringify(["folder-membership", folderId, statusId]),
            folderId,
            statusId,
            value: { folderId, statusId, addedAt: 12 },
          },
        },
        {
          operationId: "evidence",
          baseRevision: 0,
          entity: {
            kind: "bookmark-evidence" as const,
            key: JSON.stringify(["bookmark-evidence", statusId, "x-account-1"]),
            statusId,
            xAccountId: "x-account-1",
            value: {
              statusId,
              xAccountId: "x-account-1",
              outcome: "confirmed" as const,
              observedAt: 13,
            },
          },
        },
      ],
    });

    const rows = await t.run(async (ctx) => ({
      accounts: await ctx.db.query("accounts").collect(),
      lists: await ctx.db.query("lists").collect(),
      members: await ctx.db.query("members").collect(),
      events: await ctx.db.query("events").collect(),
      entities: await ctx.db.query("folderReplicaEntities").collect(),
    }));
    expect(rows.accounts).toEqual([]);
    expect(rows.lists).toEqual([]);
    expect(rows.members).toEqual([]);
    expect(rows.events).toEqual([]);
    expect(rows.entities).toHaveLength(4);
    expect(JSON.stringify(rows.entities)).not.toContain(DEVICE_KEY);
    for (const row of rows.entities) {
      if (row.entity.kind !== "bookmark-evidence") {
        expect(JSON.stringify(row.entity)).not.toContain("xAccountId");
      }
    }
  });

  test("rejects membership into a soft-deleted Folder before writing", async () => {
    const t = convexTest(schema, modules);
    const folderId = "folder-1";
    const statusId = "status-1";
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "folder-create",
          baseRevision: 0,
          entity: folderEntity(folderId),
        },
        {
          operationId: "post-create",
          baseRevision: 0,
          entity: savedPostEntity(statusId),
        },
      ],
    });
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "folder-soft-delete",
          baseRevision: 1,
          entity: folderEntity(folderId, {
            ...folderValue(folderId),
            deletedAt: 12,
          }),
        },
      ],
    });

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "soft-deleted-membership",
            baseRevision: 0,
            entity: {
              kind: "folder-membership",
              key: JSON.stringify(["folder-membership", folderId, statusId]),
              folderId,
              statusId,
              value: { folderId, statusId, addedAt: 13 },
            },
          },
        ],
      }),
    ).rejects.toThrow("folder-membership Folder references a missing or tombstoned record");
    await expect(
      t.run((ctx) => ctx.db.query("folderReplicaChanges").collect()),
    ).resolves.toHaveLength(3);
  });

  test("rejects every stale atomic Folder reorder without a partial sort update", async () => {
    const t = convexTest(schema, modules);
    const firstId = "folder-a";
    const secondId = "folder-b";
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "create-a",
          baseRevision: 0,
          entity: folderEntity(firstId, folderValue(firstId, "A")),
        },
        {
          operationId: "create-b",
          baseRevision: 0,
          entity: folderEntity(secondId, folderValue(secondId, "B")),
        },
      ],
    });

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "reorder-a",
            baseRevision: 1,
            atomicGroupId: "reorder-1",
            atomicGroupSize: 2,
            entity: folderEntity(firstId, {
              ...folderValue(firstId, "A"),
              sortIndex: 1,
              updatedAt: 11,
            }),
          },
          {
            operationId: "reorder-b-stale",
            baseRevision: 1,
            atomicGroupId: "reorder-1",
            atomicGroupSize: 2,
            entity: folderEntity(secondId, {
              ...folderValue(secondId, "B"),
              sortIndex: 0,
              updatedAt: 11,
            }),
          },
        ],
      }),
    ).resolves.toEqual({
      results: [
        { operationId: "reorder-a", status: "conflict", revision: 1 },
        { operationId: "reorder-b-stale", status: "conflict", revision: 2 },
      ],
    });

    const folders = await t.run((ctx) => ctx.db.query("folderReplicaEntities").collect());
    expect(
      folders.find((row) => row.entity.kind === "folder" && row.entity.folderId === firstId)
        ?.entity,
    ).toMatchObject({ value: { sortIndex: 0 } });
    expect(
      folders.find((row) => row.entity.kind === "folder" && row.entity.folderId === secondId)
        ?.entity,
    ).toMatchObject({ value: { sortIndex: 0 } });
    await expect(
      t.run((ctx) => ctx.db.query("folderReplicaChanges").collect()),
    ).resolves.toHaveLength(2);
  });

  test("returns revision zero as a conflict receipt for a new Folder in a rejected reorder", async () => {
    const t = convexTest(schema, modules);
    const existingId = "folder-existing";
    const newId = "folder-new";
    await t.mutation(api.folderReplica.push, {
      deviceKey: DEVICE_KEY,
      mutations: [
        {
          operationId: "create-existing",
          baseRevision: 0,
          entity: folderEntity(existingId, folderValue(existingId, "Existing")),
        },
      ],
    });

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "stale-existing",
            baseRevision: 0,
            atomicGroupId: "rejected-reorder",
            atomicGroupSize: 2,
            entity: folderEntity(existingId, {
              ...folderValue(existingId, "Existing"),
              sortIndex: 1,
              updatedAt: 11,
            }),
          },
          {
            operationId: "new-in-reorder",
            baseRevision: 0,
            atomicGroupId: "rejected-reorder",
            atomicGroupSize: 2,
            entity: folderEntity(newId, {
              ...folderValue(newId, "New"),
              sortIndex: 0,
              updatedAt: 11,
            }),
          },
        ],
      }),
    ).resolves.toEqual({
      results: [
        { operationId: "stale-existing", status: "conflict", revision: 1 },
        { operationId: "new-in-reorder", status: "conflict", revision: 0 },
      ],
    });
    await expect(
      t.run((ctx) =>
        ctx.db
          .query("folderReplicaEntities")
          .withIndex("by_key", (q) => q.eq("key", JSON.stringify(["folder", newId])))
          .unique(),
      ),
    ).resolves.toBeNull();
  });

  test("rejects interleaved atomic group members before writing any mutation", async () => {
    const t = convexTest(schema, modules);
    const firstId = "folder-first";
    const secondId = "folder-second";

    await expect(
      t.mutation(api.folderReplica.push, {
        deviceKey: DEVICE_KEY,
        mutations: [
          {
            operationId: "group-first",
            baseRevision: 0,
            atomicGroupId: "interleaved-group",
            atomicGroupSize: 2,
            entity: folderEntity(firstId, folderValue(firstId, "First")),
          },
          {
            operationId: "interleaved-post",
            baseRevision: 0,
            entity: savedPostEntity("status-between-folders"),
          },
          {
            operationId: "group-second",
            baseRevision: 0,
            atomicGroupId: "interleaved-group",
            atomicGroupSize: 2,
            entity: folderEntity(secondId, folderValue(secondId, "Second")),
          },
        ],
      }),
    ).rejects.toThrow("atomic group members must be contiguous");
    await expect(t.run((ctx) => ctx.db.query("folderReplicaEntities").collect())).resolves.toEqual(
      [],
    );
  });

  test("rejects an over-capacity batch before writing any mutation", async () => {
    const t = convexTest(schema, modules);
    const mutations = Array.from({ length: MAX_REPLICA_MUTATIONS + 1 }, (_, index) => ({
      operationId: `op-${index}`,
      baseRevision: 0,
      entity: folderEntity(`folder-${index}`),
    }));

    await expect(
      t.mutation(api.folderReplica.push, { deviceKey: DEVICE_KEY, mutations }),
    ).rejects.toThrow(`at most ${MAX_REPLICA_MUTATIONS} mutations`);
    await expect(
      t.run(async (ctx) => ({
        entities: await ctx.db.query("folderReplicaEntities").collect(),
        changes: await ctx.db.query("folderReplicaChanges").collect(),
        receipts: await ctx.db.query("folderReplicaReceipts").collect(),
      })),
    ).resolves.toEqual({ entities: [], changes: [], receipts: [] });
  });
});
