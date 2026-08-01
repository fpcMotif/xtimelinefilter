import { describe, expect, it } from "vitest";

import { createFolderPickerController, type FolderSource } from "@/core/folder-picker-controller";
import type { Folder, PostCapture } from "@/packages/folders/types";

const folder = (folderId: string, name: string): Folder => ({
  folderId,
  name,
  sortIndex: 0,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

const CAPTURE: PostCapture = {
  statusId: "12345",
  permalink: "https://x.com/jack/status/12345",
  media: [],
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function source(overrides: Partial<FolderSource> = {}): FolderSource {
  return {
    listFolders: async () => [folder("fld_a", "Alpha"), folder("fld_b", "Beta")],
    foldersHolding: async () => [],
    ...overrides,
  };
}

describe("FolderPickerController", () => {
  it("loads Folders, marks the ones already holding the post, then goes ready", async () => {
    const controller = createFolderPickerController({
      collections: source({ foldersHolding: async () => ["fld_b"] }),
    });
    expect(controller.view.value.status).toBe("loading");
    await controller.open(CAPTURE);
    const view = controller.view.value;
    expect(view.status).toBe("ready");
    expect(view.rows.map((row) => row.folder.name)).toEqual(["Alpha", "Beta"]);
    expect(view.rows.map((row) => row.holding)).toEqual([false, true]);
    expect(Object.isFrozen(view.rows[0]!.folder)).toBe(true);
  });

  it("skips the holding read when the capture carries no statusId", async () => {
    let called = false;
    const controller = createFolderPickerController({
      collections: source({
        foldersHolding: async () => {
          called = true;
          return [];
        },
      }),
    });
    await controller.open({ statusId: null, permalink: null, media: [] });
    expect(called).toBe(false);
    expect(controller.view.value.status).toBe("ready");
  });

  it("reports empty only once loaded, with no query and no rows", async () => {
    const controller = createFolderPickerController({
      collections: source({ listFolders: async () => [] }),
    });
    await controller.open(CAPTURE);
    expect(controller.view.value.status).toBe("empty");
  });

  it("goes to error when Folders cannot be loaded, and retry recovers", async () => {
    let fail = true;
    const controller = createFolderPickerController({
      collections: source({
        listFolders: async () => {
          if (fail) throw new Error("worker down");
          return [folder("fld_a", "Alpha")];
        },
      }),
    });
    await controller.open(CAPTURE);
    expect(controller.view.value.status).toBe("error");

    fail = false;
    controller.act({ type: "retry" });
    await flush();
    expect(controller.view.value.status).toBe("ready");
  });

  it("does nothing on retry before any Folder was ever opened", () => {
    const controller = createFolderPickerController({ collections: source() });
    expect(controller.act({ type: "retry" })).toBeNull();
    expect(controller.view.value.status).toBe("loading");
  });

  it("filters rows by query and resets the active row", async () => {
    const controller = createFolderPickerController({ collections: source() });
    await controller.open(CAPTURE);
    controller.act({ type: "move", direction: "down" });
    expect(controller.view.value.activeIndex).toBe(1);

    controller.act({ type: "query", value: "al" });
    expect(controller.view.value.rows.map((row) => row.folder.name)).toEqual(["Alpha"]);
    expect(controller.view.value.activeIndex).toBe(0);
    expect(controller.view.value.noMatch).toBe(false);
  });

  it("reports no match for a query nothing ranks", async () => {
    const controller = createFolderPickerController({ collections: source() });
    await controller.open(CAPTURE);
    controller.act({ type: "query", value: "zzz" });
    expect(controller.view.value.rows).toEqual([]);
    expect(controller.view.value.noMatch).toBe(true);
  });

  it("moving with no rows selects nothing", async () => {
    const controller = createFolderPickerController({
      collections: source({ listFolders: async () => [] }),
    });
    await controller.open(CAPTURE);
    controller.act({ type: "move", direction: "down" });
    expect(controller.view.value.active).toBeNull();
  });

  it("clamps move at both ends instead of wrapping", async () => {
    const controller = createFolderPickerController({ collections: source() });
    await controller.open(CAPTURE);
    controller.act({ type: "move", direction: "up" });
    expect(controller.view.value.activeIndex).toBe(0);
    controller.act({ type: "move", direction: "down" });
    controller.act({ type: "move", direction: "down" });
    controller.act({ type: "move", direction: "down" });
    expect(controller.view.value.activeIndex).toBe(1);
  });

  it("chooses a row once, carrying the captured post through", async () => {
    const controller = createFolderPickerController({ collections: source() });
    await controller.open(CAPTURE);
    const effect = controller.act({ type: "choose", rowKey: "fld_b" });
    expect(effect).toEqual({
      type: "chosen",
      folderId: "fld_b",
      folderName: "Beta",
      capture: CAPTURE,
    });
    // A second choose after the first is consumed answers nothing.
    expect(controller.act({ type: "choose", rowKey: "fld_a" })).toBeNull();
  });

  it("answers nothing for an unknown row key", async () => {
    const controller = createFolderPickerController({ collections: source() });
    await controller.open(CAPTURE);
    expect(controller.act({ type: "choose", rowKey: "nope" })).toBeNull();
  });

  it("consumes the choice on close, so a pending choose can no longer land", async () => {
    const controller = createFolderPickerController({ collections: source() });
    await controller.open(CAPTURE);
    expect(controller.act({ type: "close" })).toBeNull();
    expect(controller.act({ type: "choose", rowKey: "fld_a" })).toBeNull();
  });

  it("discards a stale open's results once a newer generation has begun", async () => {
    let calls = 0;
    let releaseFirst!: (folders: Folder[]) => void;
    const firstPromise = new Promise<Folder[]>((resolve) => {
      releaseFirst = resolve;
    });
    const controller = createFolderPickerController({
      collections: source({
        listFolders: () => {
          calls += 1;
          return calls === 1 ? firstPromise : Promise.resolve([folder("fld_c", "Gamma")]);
        },
      }),
    });
    const first = controller.open(CAPTURE);
    await controller.open({ ...CAPTURE, statusId: "999" });
    expect(controller.view.value.status).toBe("ready");
    expect(controller.view.value.rows.map((row) => row.folder.folderId)).toEqual(["fld_c"]);

    releaseFirst([folder("fld_a", "Alpha")]);
    await first;
    // The stale open's answer never overwrote the newer generation's state.
    expect(controller.view.value.rows.map((row) => row.folder.folderId)).toEqual(["fld_c"]);
  });

  it("discards a stale error from an open that is no longer current", async () => {
    let calls = 0;
    let rejectFirst!: (err: unknown) => void;
    const firstPromise = new Promise<Folder[]>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const controller = createFolderPickerController({
      collections: source({
        listFolders: () => {
          calls += 1;
          return calls === 1 ? firstPromise : Promise.resolve([folder("fld_a", "Alpha")]);
        },
      }),
    });
    const first = controller.open(CAPTURE);
    await controller.open(CAPTURE);
    expect(controller.view.value.status).toBe("ready");

    rejectFirst(new Error("too late"));
    await first;
    expect(controller.view.value.status).toBe("ready");
  });
});
