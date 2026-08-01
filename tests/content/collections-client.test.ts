import { afterEach, describe, expect, it, vi } from "vitest";

import { createCollectionsClient } from "@/content/collections-client";
import type { PostCapture } from "@/packages/folders/types";

const TOKEN = { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 };
const STATUS = "1234567890";
const FOLDER = "fld_abcdefghijklmnopqrst";

const capture: PostCapture = {
  statusId: STATUS,
  permalink: `https://x.com/jack/status/${STATUS}`,
  media: [],
};

/** Answers each request in order, recording what the page actually sent. */
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

describe("the page's door to Folders", () => {
  it("mints a fence, then files, sending no account of any kind", async () => {
    const w = worker({ ok: true, defaultSave: { status: "ask" } });
    expect(await createCollectionsClient().saveToDefaultFolder(capture)).toEqual({ status: "ask" });

    expect(w.operations()).toEqual(["begin", "save-to-default-folder"]);
    // Pinned as an exact literal: an account-bearing key added under any name
    // would change this object.
    expect(w.sent[1]).toEqual({
      type: "lasso:collections",
      operation: "save-to-default-folder",
      capture,
      token: TOKEN,
    });
  });

  it("unfiles, and deletes the post only when the gesture minted it", async () => {
    const kept = worker({ ok: true }, { ok: true });
    await createCollectionsClient().undoSave({
      folderId: FOLDER,
      statusId: STATUS,
      createdSavedPost: false,
    });
    // Unfile only: the post is saved elsewhere and must survive.
    expect(kept.operations()).toEqual(["begin", "remove-from-folder"]);

    const minted = worker({ ok: true }, { ok: true });
    await createCollectionsClient().undoSave({
      folderId: FOLDER,
      statusId: STATUS,
      createdSavedPost: true,
    });
    // Unfile FIRST: deleting the post would take Folder rows this gesture
    // never touched with it. And ONE fence covers both legs, so a Clear cannot
    // land between them and leave the post unfiled but undeleted.
    expect(minted.operations()).toEqual(["begin", "remove-from-folder", "delete-saved-post"]);
    expect(minted.sent[1]?.token).toEqual(minted.sent[2]?.token);
  });

  it("throws rather than reporting a save that did not happen", async () => {
    worker({ ok: true });
    await expect(createCollectionsClient().saveToDefaultFolder(capture)).rejects.toThrow(
      "Invalid collections response",
    );

    const sendMessage = vi.fn(async () => ({ ok: false, error: "Folders unavailable" }));
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    await expect(createCollectionsClient().saveToDefaultFolder(capture)).rejects.toThrow(
      "Folders unavailable",
    );
  });

  it("throws when the fence cannot be minted", async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
    await expect(createCollectionsClient().saveToDefaultFolder(capture)).rejects.toThrow(
      "Invalid collections response",
    );
  });

  it("lists live Folders, excluding deleted ones", async () => {
    const w = worker({
      ok: true,
      folders: [
        {
          folderId: FOLDER,
          name: "Research",
          sortIndex: 0,
          createdAt: 0,
          updatedAt: 0,
          deletedAt: null,
        },
      ],
    });
    const folders = await createCollectionsClient().listFolders();
    expect(folders).toEqual([
      {
        folderId: FOLDER,
        name: "Research",
        sortIndex: 0,
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
      },
    ]);
    expect(w.sent[0]).toEqual({
      type: "lasso:collections",
      operation: "list-folders",
      includeDeleted: false,
    });
  });

  it("asks which Folders already hold a post", async () => {
    const w = worker({ ok: true, folderIds: [FOLDER] });
    const folderIds = await createCollectionsClient().foldersHolding(STATUS);
    expect(folderIds).toEqual([FOLDER]);
    expect(w.sent[0]).toEqual({
      type: "lasso:collections",
      operation: "folders-holding",
      statusId: STATUS,
    });
  });

  it("saves into a chosen Folder, minting a fence and reporting whether it minted the post", async () => {
    const w = worker({
      ok: true,
      outcome: { status: "saved", statusId: STATUS },
      createdSavedPost: true,
    });
    const outcome = await createCollectionsClient().saveToFolder(FOLDER, capture);
    expect(outcome).toEqual({ status: "saved", statusId: STATUS, createdSavedPost: true });
    expect(w.operations()).toEqual(["begin", "save-post"]);
    expect(w.sent[1]).toEqual({
      type: "lasso:collections",
      operation: "save-post",
      folderId: FOLDER,
      capture,
      token: TOKEN,
    });
  });
});
