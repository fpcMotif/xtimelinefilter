import { computed, type ReadonlySignal, signal } from "@preact/signals-core";

import { fuzzyRank } from "@/core/fuzzy";
import type { Folder, PostCapture } from "@/packages/folders/types";

/**
 * The narrow read the Folder Picker needs from Folders. Declared here, not
 * imported from `@/content/collections-client`: `core` sits below `content`
 * in this repo's layering, and a core module depending on content would
 * invert it. `CollectionsClient` satisfies this structurally — it carries
 * these two methods plus others the picker never calls — so no change is
 * needed where a `CollectionsClient` is handed in.
 */
export interface FolderSource {
  /** Live (non-deleted) Folders for the Folder Picker. */
  listFolders(): Promise<Folder[]>;
  /** Which Folders already hold this post (so the picker can mark them). */
  foldersHolding(statusId: string): Promise<string[]>;
}

export type FolderPickerStatus = "loading" | "ready" | "empty" | "error";

export interface FolderPickerRow {
  readonly key: string;
  readonly folder: Readonly<Folder>;
  readonly holding: boolean;
}

export interface FolderPickerView {
  readonly status: FolderPickerStatus;
  readonly query: string;
  readonly rows: readonly FolderPickerRow[];
  readonly activeIndex: number;
  readonly active: FolderPickerRow | null;
  readonly noMatch: boolean;
}

export type FolderPickerIntent =
  | { type: "query"; value: string }
  | { type: "move"; direction: "up" | "down" }
  | { type: "choose"; rowKey: string }
  | { type: "retry" }
  | { type: "close" };

export type FolderPickerEffect = {
  type: "chosen";
  folderId: string;
  folderName: string;
  capture: PostCapture;
} | null;

export interface FolderPickerControllerDeps {
  collections: FolderSource;
}

export interface FolderPickerController {
  readonly view: ReadonlySignal<FolderPickerView>;
  open(capture: PostCapture): Promise<void>;
  act(intent: FolderPickerIntent): FolderPickerEffect;
}

const clamp = (index: number, length: number): number =>
  length === 0 ? 0 : Math.max(0, Math.min(index, length - 1));

/**
 * The Folder Picker controller. Simpler than the List Picker: Folders are
 * account-free, so there is no Owner guard, no membership store, and no scope
 * switching. It loads Folders, marks the ones that already hold the captured
 * post, and files on choose.
 */
export function createFolderPickerController(
  deps: FolderPickerControllerDeps,
): FolderPickerController {
  const status = signal<FolderPickerStatus>("loading");
  const query = signal("");
  const folders = signal<Folder[]>([]);
  const holding = signal<ReadonlySet<string>>(new Set());
  const activeRowKey = signal<string | null>(null);
  let generation = 0;
  let choiceConsumed = false;
  let pendingCapture: PostCapture | null = null;
  const rowKeyMap = new Map<string, Folder>();

  const view = computed<FolderPickerView>(() => {
    const q = query.value.trim();
    const allRows: FolderPickerRow[] = folders.value.map((folder) => ({
      key: folder.folderId,
      folder: Object.freeze({ ...folder }),
      holding: holding.value.has(folder.folderId),
    }));
    const ranked = q ? fuzzyRank(q, allRows, (row) => row.folder.name) : allRows;
    rowKeyMap.clear();
    for (const row of ranked) rowKeyMap.set(row.key, row.folder);
    const requestedIndex = activeRowKey.value
      ? ranked.findIndex((row) => row.key === activeRowKey.value)
      : 0;
    // clamp() already floors a negative index at 0 (findIndex's "not found"),
    // and nothing here can orphan a selected key against a shorter list without
    // resetting it first — unlike the List Picker, no async Mirror update
    // mutates rows outside act().
    const activeIndex = clamp(requestedIndex, ranked.length);
    const visibleStatus =
      status.value === "ready" && ranked.length === 0 && q === "" ? "empty" : status.value;
    return {
      status: visibleStatus,
      query: query.value,
      rows: ranked,
      activeIndex,
      active: ranked[activeIndex] ?? null,
      noMatch: visibleStatus === "ready" && q !== "" && ranked.length === 0,
    };
  });

  const isCurrent = (candidate: number): boolean => candidate === generation;

  async function open(capture: PostCapture): Promise<void> {
    const candidate = ++generation;
    choiceConsumed = false;
    pendingCapture = capture;
    query.value = "";
    activeRowKey.value = null;
    folders.value = [];
    holding.value = new Set();
    status.value = "loading";

    try {
      const [folderList, holdingIds] = await Promise.all([
        deps.collections.listFolders(),
        capture.statusId ? deps.collections.foldersHolding(capture.statusId) : Promise.resolve([]),
      ]);
      if (!isCurrent(candidate)) return;
      folders.value = folderList;
      holding.value = new Set(holdingIds);
      status.value = "ready";
    } catch {
      if (!isCurrent(candidate)) return;
      status.value = "error";
    }
  }

  return {
    view,
    open,
    act(intent) {
      if (intent.type === "query") {
        query.value = intent.value;
        activeRowKey.value = null;
        return null;
      }
      if (intent.type === "move") {
        const { rows, activeIndex } = view.value;
        const delta = intent.direction === "down" ? 1 : -1;
        activeRowKey.value = rows[clamp(activeIndex + delta, rows.length)]?.key ?? null;
        return null;
      }
      if (intent.type === "retry") {
        if (pendingCapture) void open(pendingCapture);
        return null;
      }
      if (intent.type === "close") {
        choiceConsumed = true;
        generation++;
        return null;
      }

      // choose
      if (choiceConsumed) return null;
      void view.value;
      const folder = rowKeyMap.get(intent.rowKey);
      const capture = pendingCapture;
      if (!folder || !capture) return null;
      choiceConsumed = true;
      return {
        type: "chosen",
        folderId: folder.folderId,
        folderName: folder.name,
        capture,
      };
    },
  };
}
