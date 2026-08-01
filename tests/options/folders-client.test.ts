import { afterEach, describe, expect, it, vi } from "vitest";

import { createFoldersClient } from "@/options/folders-client";

const TOKEN = { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 };
const FOLDER = "fld_abcdefghijklmnopqrst";

const FOLDER_ROW = {
  folderId: FOLDER,
  name: "Research",
  sortIndex: 0,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
};

/** Answers each request in order, recording what Options actually sent. */
function worker(...answers: unknown[]) {
  const sent: Record<string, unknown>[] = [];
  const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
    sent.push(message);
    return message.operation === "begin" ? { ok: true, token: TOKEN } : answers.shift();
  });
  globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
  return { sent, operations: () => sent.map((message) => message.operation) };
}

afterEach(() => {
  globalThis.chrome = { storage: globalThis.chrome?.storage } as unknown as typeof chrome;
});

describe("the Options workshop's door to Folders", () => {
  it("lists live Folders without minting a fence — it is a read", async () => {
    const w = worker({ ok: true, folders: [FOLDER_ROW] });
    expect(await createFoldersClient().listFolders()).toEqual([FOLDER_ROW]);
    expect(w.operations()).toEqual(["list-folders"]);
    expect(w.sent[0]).toEqual({
      type: "lasso:collections",
      operation: "list-folders",
      includeDeleted: false,
    });
  });

  it("mints a fence before creating, sending no account of any kind", async () => {
    const w = worker({ ok: true, folder: FOLDER_ROW });
    expect(await createFoldersClient().createFolder("Research")).toEqual(FOLDER_ROW);
    expect(w.operations()).toEqual(["begin", "create-folder"]);
    expect(w.sent[1]).toEqual({
      type: "lasso:collections",
      operation: "create-folder",
      name: "Research",
      token: TOKEN,
    });
  });

  it("renames a Folder", async () => {
    const w = worker({ ok: true });
    await createFoldersClient().renameFolder(FOLDER, "Design");
    expect(w.operations()).toEqual(["begin", "rename-folder"]);
    expect(w.sent[1]).toEqual({
      type: "lasso:collections",
      operation: "rename-folder",
      folderId: FOLDER,
      name: "Design",
      token: TOKEN,
    });
  });

  it("reorders Folders", async () => {
    const w = worker({ ok: true });
    await createFoldersClient().reorderFolders([FOLDER, "fld_bbbbbbbbbbbbbbbbbbbb"]);
    expect(w.sent[1]).toEqual({
      type: "lasso:collections",
      operation: "reorder-folders",
      folderIds: [FOLDER, "fld_bbbbbbbbbbbbbbbbbbbb"],
      token: TOKEN,
    });
  });

  it("deletes a Folder with the given disposition", async () => {
    const w = worker({ ok: true });
    await createFoldersClient().deleteFolder(FOLDER, "delete-orphaned-posts");
    expect(w.sent[1]).toEqual({
      type: "lasso:collections",
      operation: "delete-folder",
      folderId: FOLDER,
      disposition: "delete-orphaned-posts",
      token: TOKEN,
    });
  });

  it("reads a Folder's own count cheaply, with no fence and no shared number", async () => {
    const w = worker({ ok: true, count: 3 });
    expect(await createFoldersClient().countFolder(FOLDER)).toBe(3);
    expect(w.operations()).toEqual(["count-folder"]);
    expect(w.sent[0]).toEqual({
      type: "lasso:collections",
      operation: "count-folder",
      folderId: FOLDER,
    });
  });

  it("reads the shared count on its own dedicated operation, for the delete confirmation alone", async () => {
    const w = worker({ ok: true, count: 3, shared: 1 });
    expect(await createFoldersClient().countFolderForDelete(FOLDER)).toEqual({
      count: 3,
      shared: 1,
    });
    expect(w.operations()).toEqual(["count-folder-shared"]);
    expect(w.sent[0]).toEqual({
      type: "lasso:collections",
      operation: "count-folder-shared",
      folderId: FOLDER,
    });
  });

  it("reads the deduped global summary, with no fence", async () => {
    const w = worker({ ok: true, counts: { folders: 2, savedPosts: 5 } });
    expect(await createFoldersClient().counts()).toEqual({ folders: 2, savedPosts: 5 });
    expect(w.operations()).toEqual(["counts"]);
  });

  it("reads one bounded Folder page with no fence and no Owner field", async () => {
    const page = {
      posts: [
        {
          statusId: "2082",
          permalink: "https://x.com/ada/status/2082",
          author: { screenName: "ada" },
          text: "hello folders",
          media: [],
          capturedAt: 1_700_000_000_000,
          note: "",
          tags: [],
        },
      ],
      nextCursor: null,
    };
    const w = worker({ ok: true, page });
    expect(await createFoldersClient().readFolderPage(FOLDER, 25, null)).toEqual(page);
    expect(w.operations()).toEqual(["read-folder-page"]);
    expect(w.sent[0]).toEqual({
      type: "lasso:collections",
      operation: "read-folder-page",
      folderId: FOLDER,
      limit: 25,
      cursor: null,
    });
    expect(w.sent[0]).not.toHaveProperty("ownerUserId");
    expect(w.sent[0]).not.toHaveProperty("owner");
  });

  it("throws rather than reporting a write that did not happen", async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: "Folders unavailable" }));
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    await expect(createFoldersClient().renameFolder(FOLDER, "Design")).rejects.toThrow(
      "Folders unavailable",
    );
  });

  it("throws on a malformed response rather than returning it", async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    await expect(createFoldersClient().listFolders()).rejects.toThrow(
      "Invalid collections response",
    );
  });

  it("never carries a parent, path or depth field on any request — Folders are flat (ADR-0013)", async () => {
    const w = worker(
      { ok: true, folders: [FOLDER_ROW] },
      { ok: true, folder: FOLDER_ROW },
      { ok: true },
      { ok: true },
      { ok: true },
      { ok: true, count: 3 },
      { ok: true, count: 3, shared: 1 },
      { ok: true, counts: { folders: 1, savedPosts: 0 } },
      { ok: true, page: { posts: [], nextCursor: null } },
    );
    const client = createFoldersClient();
    await client.listFolders();
    await client.createFolder("Research");
    await client.renameFolder(FOLDER, "Design");
    await client.reorderFolders([FOLDER]);
    await client.deleteFolder(FOLDER, "keep-posts");
    await client.countFolder(FOLDER);
    await client.countFolderForDelete(FOLDER);
    await client.counts();
    await client.readFolderPage(FOLDER, 25, null);

    expect(w.sent.length).toBeGreaterThan(0);
    for (const message of w.sent) {
      expect(message, JSON.stringify(message)).not.toHaveProperty("parent");
      expect(message, JSON.stringify(message)).not.toHaveProperty("path");
      expect(message, JSON.stringify(message)).not.toHaveProperty("depth");
    }
  });

  it("degrades to a harmless inert client with no worker transport, never a wire error", async () => {
    globalThis.chrome = { runtime: {} } as unknown as typeof chrome;
    const client = createFoldersClient();

    expect(await client.listFolders()).toEqual([]);
    const created = await client.createFolder("Research");
    expect(created).toMatchObject({ name: "Research", sortIndex: 0, deletedAt: null });
    await expect(client.renameFolder(FOLDER, "Design")).resolves.toBeUndefined();
    await expect(client.reorderFolders([FOLDER])).resolves.toBeUndefined();
    await expect(client.deleteFolder(FOLDER, "keep-posts")).resolves.toBeUndefined();
    expect(await client.countFolder(FOLDER)).toBe(0);
    expect(await client.countFolderForDelete(FOLDER)).toEqual({ count: 0, shared: 0 });
    expect(await client.counts()).toEqual({ folders: 0, savedPosts: 0 });
    expect(await client.readFolderPage(FOLDER, 25, null)).toEqual({ posts: [], nextCursor: null });
  });
});
