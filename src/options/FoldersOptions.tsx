import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import {
  MAX_FOLDER_NAME,
  MAX_LIVE_FOLDERS,
  type CollectionCounts,
  type FolderCounts,
} from "@/core/protocol/collections";
import { ALWAYS_ASK } from "@/core/settings-domain";
import {
  FOLDER_CONTENTS_BACK,
  FOLDER_CONTENTS_EMPTY,
  FOLDER_CONTENTS_ERROR,
  FOLDER_CONTENTS_OPEN_ORIGINAL,
  SEEDED_FOLDER_NAME,
} from "@/core/strings";
import type { FoldersClient } from "@/options/folders-client";
import type { Folder, FolderDisposition, FolderPage, SavedPost } from "@/packages/folders/types";
import { Button, Input } from "@/ui/components";

export const FOLDERS_EMPTY = "No Folders yet — create one above to start filing posts.";
export const FOLDERS_LOAD_ERROR = "Could not load Folders.";
export const FOLDERS_WRITE_ERROR = "Could not save that change. Try again.";
export const FOLDER_NAME_TOO_LONG = `Folder names are limited to ${MAX_FOLDER_NAME} characters.`;
export const FOLDER_CAP_REACHED = `You can have at most ${MAX_LIVE_FOLDERS} folders — delete one to make room.`;
export const DEFAULT_FOLDER_ASK = "None — always ask";
/** The value the tri-state select carries for the never-set (or dangling-id) state. */
const DEFAULT_FOLDER_UNSET = "";

const codePointsAtMost = (value: string, max: number): boolean => {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > max) return false;
  }
  return true;
};

/** What the no-picker gesture would actually do right now, for the never-set preview. */
function previewDefaultFolderName(folders: Folder[]): string {
  return folders[0]?.name ?? SEEDED_FOLDER_NAME;
}

interface PendingDelete {
  folder: Folder;
  counts: FolderCounts;
}

interface FoldersDraft {
  folders: Folder[] | null;
  loadError: boolean;
  counts: CollectionCounts | null;
  writeError: boolean;
  retry(): void;
  create(name: string): Promise<void>;
  rename(folderId: string, name: string): Promise<void>;
  move(folderId: string, direction: "up" | "down"): Promise<void>;
  remove(folderId: string, disposition: FolderDisposition): Promise<void>;
}

/**
 * Owns the Folder list, the deduped aggregate total, and every write — one
 * `listFolders`/`counts` read, refreshed after each successful write rather
 * than guessed at optimistically, so a write the worker rejects leaves the
 * displayed list exactly as it was.
 */
function useFoldersDraft(client: FoldersClient): FoldersDraft {
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [counts, setCounts] = useState<CollectionCounts | null>(null);
  const [writeError, setWriteError] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadError(false);
    Promise.all([client.listFolders(), client.counts()])
      .then(([list, summary]) => {
        if (!active || !mounted.current) return;
        setFolders(list);
        setCounts(summary);
      })
      .catch(() => {
        // Never an empty list on failure — that would read as "no Folders",
        // not "the read failed". Only surface the error, and never clobber a
        // list already on screen from before a retry that failed again.
        if (active && mounted.current) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [client, revision]);

  const retry = useCallback(() => setRevision((r) => r + 1), []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [list, summary] = await Promise.all([client.listFolders(), client.counts()]);
      if (mounted.current) {
        setFolders(list);
        setCounts(summary);
        setLoadError(false);
      }
    } catch {
      // The write already reported its own outcome; leave the prior list
      // showing rather than turning a display refresh into a write failure.
    }
  }, [client]);

  const guardedWrite = useCallback(
    async (fn: () => Promise<void>): Promise<void> => {
      setWriteError(false);
      try {
        await fn();
        await refresh();
      } catch {
        if (mounted.current) setWriteError(true);
      }
    },
    [refresh],
  );

  const create = useCallback(
    (name: string) => guardedWrite(() => client.createFolder(name).then(() => undefined)),
    [client, guardedWrite],
  );
  const rename = useCallback(
    (folderId: string, name: string) => guardedWrite(() => client.renameFolder(folderId, name)),
    [client, guardedWrite],
  );
  const move = useCallback(
    (folderId: string, direction: "up" | "down") => {
      const live = folders;
      /* v8 ignore next -- every onMove callback is bound fresh (via this
         useCallback's `folders` dep) to whichever render drew the row that
         invoked it, and a row only renders once `folders` is non-null. */
      if (!live) return Promise.resolve();
      const index = live.findIndex((f) => f.folderId === folderId);
      /* v8 ignore next -- folderId always names a row this same `folders`
         array just rendered; the id cannot be absent from it. */
      if (index < 0) return Promise.resolve();
      const swapWith = direction === "up" ? index - 1 : index + 1;
      /* v8 ignore next -- the button for the unavailable direction is
         `disabled`, and a disabled button dispatches no click to reach here. */
      if (swapWith < 0 || swapWith >= live.length) return Promise.resolve();
      const next = [...live];
      const a = next[index]!;
      const b = next[swapWith]!;
      next[index] = b;
      next[swapWith] = a;
      return guardedWrite(() => client.reorderFolders(next.map((f) => f.folderId)));
    },
    [client, folders, guardedWrite],
  );
  const remove = useCallback(
    (folderId: string, disposition: FolderDisposition) =>
      guardedWrite(() => client.deleteFolder(folderId, disposition)),
    [client, guardedWrite],
  );

  return { folders, loadError, counts, writeError, retry, create, rename, move, remove };
}

function CreateFolderField({
  atCap,
  onCreate,
}: {
  atCap: boolean;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const tooLong = !codePointsAtMost(name, MAX_FOLDER_NAME);
  const blocked = atCap || trimmed.length === 0 || tooLong;

  const submit = () => {
    if (blocked) return;
    onCreate(trimmed);
    setName("");
  };

  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex gap-2">
        <Input
          aria-label="New Folder name"
          placeholder="New Folder…"
          value={name}
          disabled={atCap}
          onChange={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <Button variant="secondary" disabled={blocked} onClick={submit}>
          Create
        </Button>
      </div>
      {atCap && <p class="text-muted-foreground text-compact">{FOLDER_CAP_REACHED}</p>}
      {!atCap && tooLong && (
        <p class="text-muted-foreground text-compact">{FOLDER_NAME_TOO_LONG}</p>
      )}
    </div>
  );
}

function FolderRow({
  folder,
  index,
  total,
  client,
  onRename,
  onMove,
  onDeleteRequested,
  onBrowse,
}: {
  folder: Folder;
  index: number;
  total: number;
  client: FoldersClient;
  onRename: (folderId: string, name: string) => void;
  onMove: (folderId: string, direction: "up" | "down") => void;
  onDeleteRequested: (folder: Folder, counts: FolderCounts) => void;
  onBrowse: (folder: Folder) => void;
}) {
  const [draft, setDraft] = useState(folder.name);
  const [editing, setEditing] = useState(false);
  const [rowCount, setRowCount] = useState<number | null>(null);

  // Resync the draft to the canonical name, but never while the user is
  // mid-edit — an external refresh must not clobber an in-progress keystroke.
  useEffect(() => {
    if (!editing) setDraft(folder.name);
  }, [folder.name, editing]);

  useEffect(() => {
    // `active` alone is this effect's whole unmount guard: its deps never
    // change without the row itself unmounting first (folderId is the row's
    // own `key`), so there is no "stale effect, still-mounted row" case for a
    // second, separately-toggled ref to catch.
    let active = true;
    client
      .countFolder(folder.folderId)
      .then((c) => {
        if (active) setRowCount(c);
      })
      .catch(() => {
        // The row still renders with no count rather than blocking on it; the
        // section-level read failure is what surfaces an error to the user.
      });
    return () => {
      active = false;
    };
  }, [client, folder.folderId]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    const tooLong = !codePointsAtMost(draft, MAX_FOLDER_NAME);
    if (trimmed.length === 0 || tooLong || trimmed === folder.name) {
      setDraft(folder.name);
      return;
    }
    onRename(folder.folderId, trimmed);
  };

  const requestDelete = async () => {
    // Fresh at the moment of asking, never the row's last-rendered snapshot —
    // the confirmation's counts must be right even if they shifted meanwhile.
    // This is the only caller that pays for the shared count.
    const fresh = await client.countFolderForDelete(folder.folderId).catch(() => null);
    if (fresh) onDeleteRequested(folder, fresh);
  };

  return (
    <li class="border-border flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm">
      <span class="flex flex-col gap-0.5">
        <Button
          variant="ghost"
          size="sm"
          class="h-5 px-1.5 text-xs leading-none"
          aria-label={`Move ${folder.name} up`}
          disabled={index === 0}
          onClick={() => onMove(folder.folderId, "up")}
        >
          ▲
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-5 px-1.5 text-xs leading-none"
          aria-label={`Move ${folder.name} down`}
          disabled={index === total - 1}
          onClick={() => onMove(folder.folderId, "down")}
        >
          ▼
        </Button>
      </span>
      <Input
        aria-label={`Rename ${folder.name}`}
        value={draft}
        class="max-w-[220px]"
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
      />
      <span class="text-faint text-compact ml-auto tabular-nums">
        {rowCount !== null ? `${rowCount} posts` : "…"}
      </span>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Browse ${folder.name}`}
        onClick={() => onBrowse(folder)}
      >
        Browse
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Delete ${folder.name}`}
        onClick={() => void requestDelete()}
      >
        Delete
      </Button>
    </li>
  );
}

/** One bounded page of a Folder's Saved Posts, with honest empty/error states. */
function FolderContents({
  folder,
  client,
  onBack,
}: {
  folder: Folder;
  client: FoldersClient;
  onBack: () => void;
}) {
  const [page, setPage] = useState<FolderPage | null>(null);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setError(false);
    client
      .readFolderPage(folder.folderId, 25, null)
      .then((p) => {
        if (active) setPage(p);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [client, folder.folderId, retryCount]);

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <Button variant="ghost" size="pill" onClick={onBack}>
          {FOLDER_CONTENTS_BACK}
        </Button>
        <h3 class="text-md font-semibold">{folder.name}</h3>
      </div>

      {error && (
        <div class="flex flex-col gap-2">
          <p role="alert" class="text-destructive text-sm">
            {FOLDER_CONTENTS_ERROR}
          </p>
          <div>
            <Button variant="outline" size="pill" onClick={() => setRetryCount((c) => c + 1)}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {!error && page === null && (
        <div class="flex flex-col gap-2">
          <div class="bg-secondary h-12 w-full animate-pulse rounded-lg" />
          <div class="bg-secondary h-12 w-full animate-pulse rounded-lg" />
        </div>
      )}

      {!error && page !== null && page.posts.length === 0 && (
        <p class="text-muted-foreground text-compact border-border rounded-xl border border-dashed px-4 py-6 text-center">
          {FOLDER_CONTENTS_EMPTY}
        </p>
      )}

      {!error && page !== null && page.posts.length > 0 && (
        <ul class="flex flex-col gap-2">
          {page.posts.map((post) => (
            <SavedPostRow key={post.statusId} post={post} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SavedPostRow({ post }: { post: SavedPost }) {
  const filedAt = new Date(post.capturedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <li class="border-border flex flex-col gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm">
      <div class="flex items-center justify-between gap-2">
        <span class="text-foreground font-medium">@{post.author?.screenName ?? "unknown"}</span>
        <span class="text-faint text-compact">{filedAt}</span>
      </div>
      {post.text && <p class="text-muted-foreground line-clamp-2">{post.text}</p>}
      {post.permalink && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary text-compact hover:underline"
        >
          {FOLDER_CONTENTS_OPEN_ORIGINAL}
        </a>
      )}
    </li>
  );
}

function DeleteConfirmation({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingDelete;
  onCancel: () => void;
  onConfirm: (disposition: FolderDisposition) => void;
}) {
  const { folder, counts } = pending;
  const orphaned = counts.count - counts.shared;
  return (
    <div class="border-destructive/30 bg-destructive/5 flex flex-col gap-3 rounded-xl border p-4">
      <span class="text-compact font-medium">
        Delete "{folder.name}"? It holds {counts.count} post{counts.count === 1 ? "" : "s"},{" "}
        {counts.shared} of which another Folder also holds.
      </span>
      <div class="flex flex-wrap gap-2">
        <Button variant="destructive" size="pill" onClick={() => onConfirm("keep-posts")}>
          Keep the {counts.count} post{counts.count === 1 ? "" : "s"}
        </Button>
        <Button
          variant="destructive"
          size="pill"
          onClick={() => onConfirm("delete-orphaned-posts")}
        >
          Delete the {orphaned} post{orphaned === 1 ? "" : "s"} only this Folder holds
        </Button>
        <Button variant="ghost" size="pill" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export interface FoldersOptionsProps {
  client: FoldersClient;
  /** The raw settings field: a Folder id, {@link ALWAYS_ASK}, or absent. */
  defaultFolderId: string | undefined;
  onPatchDefault: (defaultFolderId: string | undefined) => void;
}

/**
 * The Folders workshop: create, rename, reorder and delete Folders, and
 * nominate the default the no-picker save gesture files into. Every read and
 * write goes through {@link FoldersClient} — this component never touches
 * storage directly and never reaches the database.
 */
export function FoldersOptions({ client, defaultFolderId, onPatchDefault }: FoldersOptionsProps) {
  const draft = useFoldersDraft(client);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [browsing, setBrowsing] = useState<Folder | null>(null);

  if (draft.loadError) {
    return (
      <div class="flex flex-col gap-3">
        <p role="alert" class="text-destructive text-sm">
          {FOLDERS_LOAD_ERROR}
        </p>
        <div>
          <Button variant="outline" size="pill" onClick={draft.retry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (draft.folders === null) {
    return (
      <div class="flex flex-col gap-3">
        <div class="bg-secondary h-9 w-full animate-pulse rounded-lg" />
        <div class="bg-secondary h-16 w-full animate-pulse rounded-xl" />
      </div>
    );
  }

  const atCap = draft.folders.length >= MAX_LIVE_FOLDERS;
  // A nomination naming a Folder since deleted collapses to the same
  // never-set render as "never chosen" — there is no third, dangling state.
  const namedDefault = draft.folders.find((f) => f.folderId === defaultFolderId);
  const selectValue =
    defaultFolderId === ALWAYS_ASK ? ALWAYS_ASK : (namedDefault?.folderId ?? DEFAULT_FOLDER_UNSET);

  if (browsing) {
    return (
      <FolderContents
        folder={browsing}
        client={client}
        onBack={() => setBrowsing(null)}
      />
    );
  }

  return (
    <div class="flex flex-col gap-4">
      <CreateFolderField atCap={atCap} onCreate={(name) => void draft.create(name)} />

      {draft.writeError && (
        <p role="alert" class="text-destructive text-sm">
          {FOLDERS_WRITE_ERROR}
        </p>
      )}

      {pendingDelete && (
        <DeleteConfirmation
          pending={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={(disposition) => {
            const { folderId } = pendingDelete.folder;
            setPendingDelete(null);
            void draft.remove(folderId, disposition);
          }}
        />
      )}

      {draft.folders.length === 0 ? (
        <p class="text-muted-foreground text-compact border-border rounded-xl border border-dashed px-4 py-6 text-center">
          {FOLDERS_EMPTY}
        </p>
      ) : (
        <ul class="flex flex-col gap-1.5">
          {draft.folders.map((folder, index) => (
            <FolderRow
              key={folder.folderId}
              folder={folder}
              index={index}
              total={draft.folders!.length}
              client={client}
              onRename={(folderId, name) => void draft.rename(folderId, name)}
              onMove={(folderId, direction) => void draft.move(folderId, direction)}
              onDeleteRequested={(target, counts) => setPendingDelete({ folder: target, counts })}
              onBrowse={setBrowsing}
            />
          ))}
        </ul>
      )}

      {draft.counts && (
        <p class="text-muted-foreground text-compact border-t pt-3">
          {draft.counts.savedPosts} saved post{draft.counts.savedPosts === 1 ? "" : "s"} total,
          across {draft.counts.folders} Folder{draft.counts.folders === 1 ? "" : "s"}
        </p>
      )}

      <div class="flex flex-col gap-1.5">
        <span class="text-faint text-2xs font-semibold tracking-wide uppercase">
          Default Folder
        </span>
        <select
          aria-label="Default Folder"
          value={selectValue}
          onChange={(e) => {
            const value = (e.currentTarget as HTMLSelectElement).value;
            onPatchDefault(value === DEFAULT_FOLDER_UNSET ? undefined : value);
          }}
          class="border-input bg-secondary text-foreground focus-visible:border-primary focus-visible:ring-ring/40 h-9 w-full rounded-lg border px-3 text-sm transition-[color,box-shadow,border-color] outline-none focus-visible:ring-2"
        >
          <option value={DEFAULT_FOLDER_UNSET}>
            Not set yet — currently files into "{previewDefaultFolderName(draft.folders)}"
          </option>
          <option value={ALWAYS_ASK}>{DEFAULT_FOLDER_ASK}</option>
          {draft.folders.map((f) => (
            <option key={f.folderId} value={f.folderId}>
              {f.name}
            </option>
          ))}
        </select>
        <p class="text-muted-foreground text-compact">
          Alt+Shift+B files straight into this Folder.
        </p>
      </div>
    </div>
  );
}
