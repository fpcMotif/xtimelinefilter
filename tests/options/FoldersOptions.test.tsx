import { act, fireEvent, render, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { ALWAYS_ASK } from "@/core/settings-domain";
import type { FoldersClient } from "@/options/folders-client";
import {
  DEFAULT_FOLDER_ASK,
  FOLDER_CAP_REACHED,
  FOLDER_NAME_TOO_LONG,
  FoldersOptions,
} from "@/options/FoldersOptions";
import type { Folder, FolderDisposition, SavedPost } from "@/packages/folders/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * A real in-memory model of Folder + membership, driving `FoldersClient`'s
 * exact contract — not a stub that returns canned values, so create/rename/
 * reorder/delete and the two count reads behave the way the worker's own
 * store would. `seedMembership` is a test-only back door (Options never files
 * a post; that is the timeline's gesture) so a Folder can start non-empty.
 */
function fakeFoldersClient(seed: string[] = []) {
  let nextId = 1;
  const mint = () => `fld_${String(nextId++).padStart(20, "0")}`;
  let folders: Folder[] = seed.map((name, i) => ({
    folderId: mint(),
    name,
    sortIndex: i,
    createdAt: i,
    updatedAt: i,
    deletedAt: null,
  }));
  const membership = new Map<string, Set<string>>();
  const savedPosts = new Map<string, SavedPost>();
  const calls: string[] = [];
  let listFoldersImpl = async () => folders.filter((f) => !f.deletedAt).map((f) => ({ ...f }));
  let writeShouldFail = false;
  let deletePreviewShouldFail = false;
  let readFolderPageShouldFail = false;

  const held = (folderId: string) => membership.get(folderId) ?? new Set<string>();

  const client: FoldersClient = {
    async listFolders() {
      calls.push("listFolders");
      return listFoldersImpl();
    },
    async createFolder(name) {
      calls.push("createFolder");
      if (writeShouldFail) throw new Error("worker rejected it");
      const folder: Folder = {
        folderId: mint(),
        name,
        sortIndex: folders.length,
        createdAt: folders.length,
        updatedAt: folders.length,
        deletedAt: null,
      };
      folders = [...folders, folder];
      return { ...folder };
    },
    async renameFolder(folderId, name) {
      calls.push("renameFolder");
      if (writeShouldFail) throw new Error("worker rejected it");
      folders = folders.map((f) => (f.folderId === folderId ? { ...f, name } : f));
    },
    async reorderFolders(folderIds) {
      calls.push("reorderFolders");
      if (writeShouldFail) throw new Error("worker rejected it");
      const named = folderIds
        .map((id) => folders.find((f) => f.folderId === id))
        .filter((f): f is Folder => !!f);
      const rest = folders.filter((f) => !folderIds.includes(f.folderId));
      folders = [...named, ...rest].map((f, i) => ({ ...f, sortIndex: i }));
    },
    async deleteFolder(folderId, disposition: FolderDisposition) {
      calls.push("deleteFolder");
      if (writeShouldFail) throw new Error("worker rejected it");
      const removed = held(folderId);
      membership.delete(folderId);
      folders = folders.map((f) => (f.folderId === folderId ? { ...f, deletedAt: 1 } : f));
      if (disposition === "delete-orphaned-posts") {
        for (const statusId of removed) {
          const stillHeld = [...membership.values()].some((set) => set.has(statusId));
          if (!stillHeld) {
            for (const set of membership.values()) set.delete(statusId);
          }
        }
      }
    },
    async countFolder(folderId) {
      calls.push("countFolder");
      return held(folderId).size;
    },
    async countFolderForDelete(folderId) {
      calls.push("countFolderForDelete");
      if (deletePreviewShouldFail) throw new Error("worker rejected it");
      const mine = held(folderId);
      let shared = 0;
      for (const statusId of mine) {
        const elsewhere = [...membership.entries()].some(
          ([id, set]) => id !== folderId && set.has(statusId),
        );
        if (elsewhere) shared += 1;
      }
      return { count: mine.size, shared };
    },
    async counts() {
      calls.push("counts");
      const distinct = new Set<string>();
      for (const set of membership.values()) for (const statusId of set) distinct.add(statusId);
      return { folders: folders.filter((f) => !f.deletedAt).length, savedPosts: distinct.size };
    },
    async readFolderPage(folderId, limit, cursor) {
      calls.push("readFolderPage");
      if (readFolderPageShouldFail) throw new Error("worker rejected it");
      const ids = [...(membership.get(folderId) ?? [])];
      const start = cursor ? Number(cursor) : 0;
      const slice = ids.slice(start, start + limit);
      const posts = slice
        .map((id) => savedPosts.get(id))
        .filter((p): p is SavedPost => !!p);
      const nextCursor = start + limit < ids.length ? String(start + limit) : null;
      return { posts, nextCursor };
    },
  };

  return {
    client,
    calls,
    folders: () => folders,
    seedMembership(folderId: string, statusId: string) {
      if (!membership.has(folderId)) membership.set(folderId, new Set());
      membership.get(folderId)!.add(statusId);
    },
    seedSavedPost(post: SavedPost) {
      savedPosts.set(post.statusId, post);
    },
    failReadFolderPage(on: boolean) {
      readFolderPageShouldFail = on;
    },
    failWrites(on: boolean) {
      writeShouldFail = on;
    },
    failDeletePreview(on: boolean) {
      deletePreviewShouldFail = on;
    },
    setListFoldersImpl(impl: () => Promise<Folder[]>) {
      listFoldersImpl = impl;
    },
  };
}

function renderFolders(
  client: FoldersClient,
  props: { defaultFolderId?: string; onPatchDefault?: (id: string | undefined) => void } = {},
) {
  const onPatchDefault = props.onPatchDefault ?? vi.fn();
  const r = render(
    <FoldersOptions
      client={client}
      defaultFolderId={props.defaultFolderId}
      onPatchDefault={onPatchDefault}
    />,
  );
  return { ...r, onPatchDefault };
}

describe("FoldersOptions — reading", () => {
  it("renders every Folder's own count and the deduped aggregate total, from two dedicated reads", async () => {
    const fake = fakeFoldersClient(["Research", "Design refs"]);
    const [research, design] = fake.folders();
    fake.seedMembership(research!.folderId, "1");
    fake.seedMembership(research!.folderId, "2");
    fake.seedMembership(design!.folderId, "2"); // shared with Research
    fake.seedMembership(design!.folderId, "3");

    const r = renderFolders(fake.client);

    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());
    // Both rows carry their own membership count from the per-Folder count
    // read — Research holds 2, Design refs holds 2 — even though "2" is shared.
    await waitFor(() => expect(r.getAllByText("2 posts")).toHaveLength(2));
    // One post filed in both Folders counts once in the aggregate, not twice.
    expect(await r.findByText(/3 saved posts total, across 2 Folders/)).toBeTruthy();
  });

  it("shows an inviting empty state, not an error, with zero Folders", async () => {
    const fake = fakeFoldersClient([]);
    const r = renderFolders(fake.client);
    expect(await r.findByText(/No Folders yet/)).toBeTruthy();
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("shows an error with Retry when the read fails, never an empty list", async () => {
    const fake = fakeFoldersClient(["Research"]);
    fake.setListFoldersImpl(() => Promise.reject(new Error("offline")));
    const r = renderFolders(fake.client);

    await waitFor(() => expect(r.getByRole("alert")).toBeTruthy());
    expect(r.queryByText(/No Folders yet/)).toBeNull();
    expect(r.queryByText("Research")).toBeNull();

    fake.setListFoldersImpl(async () => fake.folders());
    fireEvent.click(r.getByText("Retry"));
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());
  });

  it("shows a row with no count, never an error, when just that row's count read fails", async () => {
    const client: FoldersClient = {
      ...fakeFoldersClient(["Research"]).client,
      countFolder: () => Promise.reject(new Error("offline")),
    };
    const r = renderFolders(client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());
    // "…" is also the row's pre-effect placeholder, so waiting for it alone
    // would pass before the rejection is even caught. A real tick lets the
    // row's effect actually run and its catch settle, so this asserts the
    // placeholder SURVIVES the failure rather than merely preceding it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(r.getByText("…")).toBeTruthy();
    expect(r.queryByRole("alert")).toBeNull();
  });
});

describe("FoldersOptions — creating", () => {
  it("creates a Folder that survives, refusing a blank or whitespace-only name inline", async () => {
    const fake = fakeFoldersClient([]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText(/No Folders yet/)).toBeTruthy());

    const createButton = () => r.getByText("Create").closest("button") as HTMLButtonElement;
    expect(createButton().disabled).toBe(true);

    fireEvent.change(r.getByLabelText("New Folder name"), { target: { value: "   " } });
    expect(createButton().disabled).toBe(true);
    expect(fake.calls.includes("createFolder")).toBe(false);

    fireEvent.change(r.getByLabelText("New Folder name"), { target: { value: "Research" } });
    expect(createButton().disabled).toBe(false);
    fireEvent.click(createButton());

    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());
    expect((r.getByLabelText("New Folder name") as HTMLInputElement).value).toBe("");
  });

  it("submits on Enter once the name is valid, and does nothing on Enter while blocked", async () => {
    const fake = fakeFoldersClient([]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText(/No Folders yet/)).toBeTruthy());
    const field = r.getByLabelText("New Folder name") as HTMLInputElement;

    fireEvent.keyDown(field, { key: "Enter" });
    expect(fake.calls.includes("createFolder")).toBe(false);

    fireEvent.change(field, { target: { value: "Research" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());
    expect(field.value).toBe("");
  });

  it("a plain keystroke in the create field submits nothing", async () => {
    const fake = fakeFoldersClient([]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText(/No Folders yet/)).toBeTruthy());
    const field = r.getByLabelText("New Folder name") as HTMLInputElement;

    fireEvent.change(field, { target: { value: "Research" } });
    fireEvent.keyDown(field, { key: "a" });
    expect(fake.calls.includes("createFolder")).toBe(false);
  });

  it("disables Create — with the reason stated — for an over-length name and at the live-Folder cap", async () => {
    const fake = fakeFoldersClient([]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText(/No Folders yet/)).toBeTruthy());

    fireEvent.change(r.getByLabelText("New Folder name"), { target: { value: "x".repeat(101) } });
    expect((r.getByText("Create").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByText(FOLDER_NAME_TOO_LONG)).toBeTruthy();
    expect(fake.calls.includes("createFolder")).toBe(false);
  });

  it("disables Create at the folder cap, stating the reason, without issuing a request", async () => {
    const fake = fakeFoldersClient(Array.from({ length: 200 }, (_, i) => `F${i}`));
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("F0")).toBeTruthy());

    expect((r.getByLabelText("New Folder name") as HTMLInputElement).disabled).toBe(true);
    expect((r.getByText("Create").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByText(FOLDER_CAP_REACHED)).toBeTruthy();
  });
});

describe("FoldersOptions — renaming", () => {
  it("renames in place on blur, surviving a re-mount against the same worker state", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByLabelText("Rename Research")).toBeTruthy());

    fireEvent.focus(r.getByLabelText("Rename Research"));
    fireEvent.change(r.getByLabelText("Rename Research"), { target: { value: "Design refs" } });
    await waitFor(() =>
      expect((r.getByLabelText("Rename Research") as HTMLInputElement).value).toBe("Design refs"),
    );
    fireEvent.blur(r.getByLabelText("Rename Research"));

    await waitFor(() => expect(fake.folders()[0]!.name).toBe("Design refs"));

    r.unmount();
    const remounted = renderFolders(fake.client);
    await waitFor(() => expect(remounted.getByText("Design refs")).toBeTruthy());
  });

  it("refuses a blank rename inline, reverting to the canonical name with no request issued", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByLabelText("Rename Research")).toBeTruthy());

    fireEvent.focus(r.getByLabelText("Rename Research"));
    fireEvent.change(r.getByLabelText("Rename Research"), { target: { value: "   " } });
    fireEvent.blur(r.getByLabelText("Rename Research"));

    expect(fake.calls.includes("renameFolder")).toBe(false);
    await waitFor(() =>
      expect((r.getByLabelText("Rename Research") as HTMLInputElement).value).toBe("Research"),
    );
  });

  it("commits on Enter — which blurs the field — but a plain keystroke does not", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByLabelText("Rename Research")).toBeTruthy());
    const field = r.getByLabelText("Rename Research") as HTMLInputElement;

    // A real focus() call, not fireEvent.focus: the component's Enter
    // handler calls the DOM's own .blur(), which is a no-op unless the
    // element is genuinely document.activeElement first.
    // A real focus(), flushed inside act(): the component's Enter handler
    // calls the DOM's own .blur(), which is a no-op unless the element is
    // genuinely document.activeElement first — fireEvent.focus alone
    // dispatches the event without moving DOM focus.
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "Design refs" } });
    // Settle before the next event: the row's resync effect (guarding on
    // `editing`) may still be flushing from mount, and firing straight
    // through would let its delayed first run clobber the just-typed draft.
    await waitFor(() => expect(field.value).toBe("Design refs"));
    fireEvent.keyDown(field, { key: "a" });
    expect(fake.calls.includes("renameFolder")).toBe(false);

    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(fake.folders()[0]!.name).toBe("Design refs"));
  });
});

describe("FoldersOptions — reordering", () => {
  it("moves with keyboard-operable controls, disables the unavailable edge, and persists the order", async () => {
    const fake = fakeFoldersClient(["A", "B", "C"]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("A")).toBeTruthy());

    expect((r.getByLabelText("Move A up") as HTMLButtonElement).disabled).toBe(true);
    expect((r.getByLabelText("Move C down") as HTMLButtonElement).disabled).toBe(true);
    expect((r.getByLabelText("Move A down") as HTMLButtonElement).disabled).toBe(false);

    const rowOrder = () =>
      [...r.container.querySelectorAll("li input")].map((el) => (el as HTMLInputElement).value);

    fireEvent.click(r.getByLabelText("Move B up"));

    await waitFor(() => expect(fake.folders().map((f) => f.name)).toEqual(["B", "A", "C"]));
    // The DOM must reflect the write too, not just the fake store — the next
    // click below targets a row by its (possibly moved) aria-label.
    await waitFor(() => expect(rowOrder()).toEqual(["B", "A", "C"]));

    fireEvent.click(r.getByLabelText("Move B down"));

    await waitFor(() => expect(fake.folders().map((f) => f.name)).toEqual(["A", "B", "C"]));
    await waitFor(() => expect(rowOrder()).toEqual(["A", "B", "C"]));

    r.unmount();
    const remounted = renderFolders(fake.client);
    await waitFor(() => {
      const names = remounted.container.querySelectorAll("li input");
      expect([...names].map((el) => (el as HTMLInputElement).value)).toEqual(["A", "B", "C"]);
    });
  });
});

describe("FoldersOptions — Folders are flat (ADR-0013 amendment)", () => {
  it("renders every row as a sibling in one list — never nested into another row", async () => {
    const fake = fakeFoldersClient(["A", "B", "C"]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("A")).toBeTruthy());

    const lists = r.container.querySelectorAll("ul");
    expect(lists).toHaveLength(1);
    const rows = lists[0]!.children;
    expect(rows).toHaveLength(3);
    // A flat sequence: no row contains a nested list — there is no
    // move-into, and nothing here could render a depth.
    for (const row of rows) {
      expect(row.querySelector("ul")).toBeNull();
    }
  });

  it("allows two Folders to carry the same name — identity is the id, not the name", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getAllByText("Research")).toHaveLength(1));

    fireEvent.change(r.getByLabelText("New Folder name"), { target: { value: "Research" } });
    fireEvent.click(r.getByText("Create").closest("button")!);

    await waitFor(() => expect(r.getAllByText("Research")).toHaveLength(2));
    expect(fake.folders().map((f) => f.name)).toEqual(["Research", "Research"]);
  });
});

describe("FoldersOptions — deleting", () => {
  it("asks with a naming, counting confirmation; Cancel issues no request", async () => {
    const fake = fakeFoldersClient(["Research", "Other"]);
    const [research, other] = fake.folders();
    fake.seedMembership(research!.folderId, "1"); // only in Research
    fake.seedMembership(research!.folderId, "2");
    fake.seedMembership(other!.folderId, "2"); // "2" is shared

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByLabelText("Delete Research")).toBeTruthy());
    fireEvent.click(r.getByLabelText("Delete Research"));

    await waitFor(() =>
      expect(
        r.getByText(/Delete "Research"\? It holds 2 posts, 1 of which another Folder also holds\./),
      ).toBeTruthy(),
    );

    fireEvent.click(r.getByText("Cancel"));
    expect(fake.calls.includes("deleteFolder")).toBe(false);
    expect(fake.folders().find((f) => f.folderId === research!.folderId)!.deletedAt).toBeNull();
  });

  it("asks for nothing when the delete preview read fails — no confirmation, no request", async () => {
    const fake = fakeFoldersClient(["Research"]);
    fake.failDeletePreview(true);

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByLabelText("Delete Research")).toBeTruthy());
    fireEvent.click(r.getByLabelText("Delete Research"));

    await waitFor(() => expect(fake.calls.includes("countFolderForDelete")).toBe(true));
    expect(r.queryByText(/Delete "Research"\?/)).toBeNull();
    expect(fake.calls.includes("deleteFolder")).toBe(false);
  });

  it("keeps a post another Folder holds under either disposition, unchanged", async () => {
    for (const disposition of ["keep-posts", "delete-orphaned-posts"] as const) {
      const fake = fakeFoldersClient(["A", "B"]);
      const [a, b] = fake.folders();
      fake.seedMembership(a!.folderId, "shared-post");
      fake.seedMembership(b!.folderId, "shared-post");

      const r = renderFolders(fake.client);
      await waitFor(() => expect(r.getByLabelText("Delete A")).toBeTruthy());
      fireEvent.click(r.getByLabelText("Delete A"));

      await waitFor(() => expect(r.getByText("Cancel")).toBeTruthy());
      const label = disposition === "keep-posts" ? /Keep the 1 post/ : /Delete the 0 posts/;
      fireEvent.click(r.getByText(label));

      await waitFor(() =>
        expect(fake.folders().find((f) => f.name === "A")!.deletedAt).not.toBeNull(),
      );
      // Still a single Saved Post, still held by B, whichever disposition ran.
      expect(await fake.client.countFolderForDelete(b!.folderId)).toEqual({ count: 1, shared: 0 });
      r.unmount();
    }
  });
});

describe("FoldersOptions — writes the worker rejects", () => {
  it("leaves the rendered list unchanged and surfaces the failure", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fake.failWrites(true);
    fireEvent.change(r.getByLabelText("New Folder name"), { target: { value: "Design refs" } });
    fireEvent.click(r.getByText("Create").closest("button")!);

    await waitFor(() => expect(r.getByRole("alert")).toBeTruthy());
    expect(r.queryByText("Design refs")).toBeNull();
    expect(r.getByText("Research")).toBeTruthy();
  });
});

describe("FoldersOptions — the default-Folder control's three states", () => {
  it("renders a nominated Folder, the explicit always-ask marker, and never-set distinguishably", async () => {
    const fake = fakeFoldersClient(["Research", "Design refs"]);
    const [research] = fake.folders();

    const nominated = renderFolders(fake.client, { defaultFolderId: research!.folderId });
    await waitFor(() =>
      expect((nominated.getByLabelText("Default Folder") as HTMLSelectElement).value).toBe(
        research!.folderId,
      ),
    );
    nominated.unmount();

    const asking = renderFolders(fake.client, { defaultFolderId: ALWAYS_ASK });
    await waitFor(() =>
      expect((asking.getByLabelText("Default Folder") as HTMLSelectElement).value).toBe(ALWAYS_ASK),
    );
    expect(asking.getByText(DEFAULT_FOLDER_ASK)).toBeTruthy();
    asking.unmount();

    const neverSet = renderFolders(fake.client, { defaultFolderId: undefined });
    await waitFor(() =>
      expect((neverSet.getByLabelText("Default Folder") as HTMLSelectElement).value).toBe(""),
    );
    expect(neverSet.getByText(/Not set yet — currently files into "Research"/)).toBeTruthy();
    neverSet.unmount();

    // A nomination naming a Folder since deleted presents identically to never-set.
    const dangling = renderFolders(fake.client, { defaultFolderId: "fld_deletedxxxxxxxxxxxx" });
    await waitFor(() =>
      expect((dangling.getByLabelText("Default Folder") as HTMLSelectElement).value).toBe(""),
    );
    expect(dangling.getByText(/Not set yet — currently files into "Research"/)).toBeTruthy();
  });

  it("previews seeding 'Saved' when the store holds no Folders at all", async () => {
    const fake = fakeFoldersClient([]);
    const r = renderFolders(fake.client, { defaultFolderId: undefined });
    await waitFor(() => expect(r.getByText(/No Folders yet/)).toBeTruthy());
    expect(r.getByText(/Not set yet — currently files into "Saved"/)).toBeTruthy();
  });

  it("patches the settings field directly — never a Folder request — when the user changes the selection", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const [research] = fake.folders();
    const r = renderFolders(fake.client, { defaultFolderId: undefined });
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.change(r.getByLabelText("Default Folder"), {
      target: { value: research!.folderId },
    });
    expect(r.onPatchDefault).toHaveBeenCalledWith(research!.folderId);

    fireEvent.change(r.getByLabelText("Default Folder"), { target: { value: ALWAYS_ASK } });
    expect(r.onPatchDefault).toHaveBeenCalledWith(ALWAYS_ASK);

    fireEvent.change(r.getByLabelText("Default Folder"), { target: { value: "" } });
    expect(r.onPatchDefault).toHaveBeenCalledWith(undefined);
  });
});

describe("FoldersOptions — late async work is dropped after unmount", () => {
  it("drops a successful initial load that resolves after unmount", async () => {
    const list = deferred<Folder[]>();
    const counts = deferred<{ folders: number; savedPosts: number }>();
    const client: FoldersClient = {
      ...fakeFoldersClient([]).client,
      listFolders: () => list.promise,
      counts: () => counts.promise,
    };
    const r = renderFolders(client);
    r.unmount();
    list.resolve([]);
    counts.resolve({ folders: 0, savedPosts: 0 });
    await Promise.resolve();
    await Promise.resolve();
    // Nothing to assert on a screen that no longer exists — the point is that
    // resolving after unmount throws no "update on an unmounted component".
  });

  it("drops a failed initial load that rejects after unmount", async () => {
    const list = deferred<Folder[]>();
    const client: FoldersClient = {
      ...fakeFoldersClient([]).client,
      listFolders: () => list.promise,
      counts: async () => ({ folders: 0, savedPosts: 0 }),
    };
    const r = renderFolders(client);
    r.unmount();
    list.reject(new Error("offline"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("drops a write failure that resolves after unmount", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const rename = deferred<void>();
    const client: FoldersClient = { ...fake.client, renameFolder: () => rename.promise };
    const r = renderFolders(client);
    await waitFor(() => expect(r.getByLabelText("Rename Research")).toBeTruthy());
    const field = r.getByLabelText("Rename Research") as HTMLInputElement;
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "Design refs" } });
    await waitFor(() => expect(field.value).toBe("Design refs"));
    fireEvent.blur(field);

    r.unmount();
    rename.reject(new Error("worker rejected it"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("drops a row's count read that resolves after unmount", async () => {
    const count = deferred<number>();
    const client: FoldersClient = {
      ...fakeFoldersClient(["Research"]).client,
      countFolder: () => count.promise,
    };
    const r = renderFolders(client);
    await waitFor(() => expect(r.getByLabelText("Rename Research")).toBeTruthy());
    // The label existing only proves the row rendered, not that its own
    // countFolder effect has actually run yet — passive effects flush on a
    // macrotask, so a microtask await races ahead of it. A real timeout lets
    // it settle before unmounting, or there is nothing yet for this test to
    // interrupt.
    await new Promise((resolve) => setTimeout(resolve, 50));
    r.unmount();
    count.resolve(3);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});

const post = (over: Partial<SavedPost> = {}): SavedPost => ({
  statusId: "2082",
  permalink: "https://x.com/ada/status/2082",
  author: { screenName: "ada" },
  text: "hello folders",
  media: [],
  capturedAt: 1_700_000_000_000,
  note: "",
  tags: [],
  ...over,
});

describe("FoldersOptions — Folder contents browser (#82)", () => {
  it("opens a Folder and shows its first page of Saved Posts", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const [folder] = fake.folders();
    fake.seedSavedPost(post());
    fake.seedSavedPost(post({ statusId: "2083", text: "second post", author: { screenName: "bob" } }));
    fake.seedMembership(folder!.folderId, "2082");
    fake.seedMembership(folder!.folderId, "2083");

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());
    expect(r.getByText("second post")).toBeTruthy();
    expect(r.getByText("@ada")).toBeTruthy();
    expect(r.getByText("@bob")).toBeTruthy();
    expect(r.getByText("Back to Folders")).toBeTruthy();
  });

  it("shows an honest empty state when the Folder holds nothing", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("This Folder has no saved posts yet.")).toBeTruthy());
    expect(r.queryByRole("alert")).toBeNull();
  });

  it("shows an error with Retry when the page read fails", async () => {
    const fake = fakeFoldersClient(["Research"]);
    fake.failReadFolderPage(true);
    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByRole("alert")).toBeTruthy());
    expect(r.getByText("Couldn't load this Folder's posts.")).toBeTruthy();

    fake.failReadFolderPage(false);
    fake.seedSavedPost(post());
    const [folder] = fake.folders();
    fake.seedMembership(folder!.folderId, "2082");
    fireEvent.click(r.getByText("Retry"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());
  });

  it("links each row to the original post on X", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const [folder] = fake.folders();
    fake.seedSavedPost(post());
    fake.seedMembership(folder!.folderId, "2082");

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());

    const link = r.getByText("Open on X").closest("a");
    expect(link?.getAttribute("href")).toBe("https://x.com/ada/status/2082");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("goes back to the Folder list without losing workshop context", async () => {
    const fake = fakeFoldersClient(["Research", "Design refs"]);
    const [research] = fake.folders();
    fake.seedSavedPost(post());
    fake.seedMembership(research!.folderId, "2082");

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());

    fireEvent.click(r.getByText("Back to Folders"));
    await waitFor(() => expect(r.getByText("Design refs")).toBeTruthy());
    expect(r.getByText("Research")).toBeTruthy();
  });

  it("a post filed in two Folders appears when browsing either", async () => {
    const fake = fakeFoldersClient(["Research", "Design refs"]);
    const [research, design] = fake.folders();
    fake.seedSavedPost(post());
    fake.seedMembership(research!.folderId, "2082");
    fake.seedMembership(design!.folderId, "2082");

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());
    fireEvent.click(r.getByText("Back to Folders"));
    await waitFor(() => expect(r.getByText("Design refs")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Design refs"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());
  });
});

describe("FoldersOptions — Folder contents paging (#83)", () => {
  it("loads the next page and appends it when more posts remain", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const [folder] = fake.folders();
    // Seed 26 posts so the first page (25) has a nextCursor.
    for (let i = 0; i < 26; i++) {
      const id = `p${i}`;
      fake.seedSavedPost(post({ statusId: id, text: `post ${i}` }));
      fake.seedMembership(folder!.folderId, id);
    }

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    // First page shows posts 0–24.
    await waitFor(() => expect(r.getByText("post 0")).toBeTruthy());
    expect(r.getByText("post 24")).toBeTruthy();
    expect(r.queryByText("post 25")).toBeNull();

    // Load more appends post 25.
    fireEvent.click(r.getByText("Load more"));
    await waitFor(() => expect(r.getByText("post 25")).toBeTruthy());
    // Earlier posts still visible.
    expect(r.getByText("post 0")).toBeTruthy();
  });

  it("shows no load-more when the Folder is fully read", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const [folder] = fake.folders();
    fake.seedSavedPost(post());
    fake.seedMembership(folder!.folderId, "2082");

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());
    expect(r.queryByText("Load more")).toBeNull();
  });

  it("Escape returns to the Folder list", async () => {
    const fake = fakeFoldersClient(["Research", "Design refs"]);
    const [folder] = fake.folders();
    fake.seedSavedPost(post());
    fake.seedMembership(folder!.folderId, "2082");

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(r.getByText("Design refs")).toBeTruthy());
    expect(r.getByText("Research")).toBeTruthy();
  });

  it("re-opening a Folder shows a fresh first page after new saves", async () => {
    const fake = fakeFoldersClient(["Research"]);
    const [folder] = fake.folders();
    fake.seedSavedPost(post());
    fake.seedMembership(folder!.folderId, "2082");

    const r = renderFolders(fake.client);
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    // First visit: one post.
    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("hello folders")).toBeTruthy());
    expect(r.queryByText("new arrival")).toBeNull();

    // Go back, save another post, re-open.
    fireEvent.click(r.getByText("Back to Folders"));
    await waitFor(() => expect(r.getByText("Research")).toBeTruthy());

    fake.seedSavedPost(post({ statusId: "3000", text: "new arrival" }));
    fake.seedMembership(folder!.folderId, "3000");

    fireEvent.click(r.getByLabelText("Browse Research"));
    await waitFor(() => expect(r.getByText("new arrival")).toBeTruthy());
    expect(r.getByText("hello folders")).toBeTruthy();
  });
});
