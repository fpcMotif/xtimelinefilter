/**
 * The Folders domain and the storage contract behind it.
 *
 * Two invariants are structural here rather than enforced by convention:
 *
 * **A Folder is not bound to an X account.** No operation below takes an Owner,
 * and no record field names an account — except `BookmarkEvidence`, which is an
 * attribute of an observation, never part of a Folder's or a post's identity.
 * The neighbouring Mirror stores shard by `ownerUserId`; Folders deliberately do
 * not, so the same Folders are present whichever account is signed in.
 *
 * **A post is saved once.** One post is one `SavedPost`, keyed by status id and
 * nothing else, however many Folders hold it and however many accounts have
 * bookmarked it.
 */

/**
 * The durable capture of a post, as the reader hands it over. Declared HERE, not
 * imported from `tweet-read`: that package's entry point transitively reaches the
 * content-script selector table, and `folders` must stay headless. A repo-level
 * type test pins the two shapes as mutually assignable.
 */
export type PostCapture = {
  /** null ⇒ the post carries no durable identity and cannot be saved. */
  statusId: string | null;
  permalink: string | null;
  author?: { screenName: string; userId?: string };
  text?: string;
  media: { kind: "photo" | "video"; url?: string }[];
  postedAt?: string;
};

/** A user-named collection Lasso owns. Not an X Premium bookmark folder. */
export interface Folder {
  folderId: string;
  name: string;
  sortIndex: number;
  createdAt: number;
  updatedAt: number;
  /**
   * Soft-delete marker: a TOMBSTONE that reserves the id, not an undo. A deleted
   * Folder leaves the default listing and its id is never minted again; its
   * membership rows are gone, so restoring the record would restore an empty
   * Folder. Un-delete is not a promise this contract makes.
   */
  deletedAt: number | null;
}

/** One post the user kept. Keyed by status id — no account component. */
export interface SavedPost {
  statusId: string;
  permalink: string | null;
  author?: { screenName: string; userId?: string };
  text?: string;
  media: { kind: "photo" | "video"; url?: string }[];
  postedAt?: string;
  /** When Lasso FIRST filed it. A re-file never moves this. */
  capturedAt: number;
  note: string;
  tags: string[];
}

/** Membership is many-to-many: filing into a second Folder adds a row, not a post. */
export interface FolderMembership {
  folderId: string;
  statusId: string;
  addedAt: number;
}

/** No rows means the bookmark leg never ran — that is not a fourth outcome. */
export type BookmarkOutcome = "confirmed" | "failed" | "skipped";

/**
 * One account's observed bookmark result for one post. The ONE record in this
 * system that names an X account, and it names it as an observation's attribute.
 */
export interface BookmarkEvidence {
  statusId: string;
  xAccountId: string;
  outcome: BookmarkOutcome;
  observedAt: number;
}

/** What became of a Folder's posts when the Folder was deleted. */
export type FolderDisposition = "keep-posts" | "delete-orphaned-posts";

/** Filing is idempotent: "already-there" is a success, distinct from a fresh save. */
export type SaveOutcome =
  | { status: "saved"; statusId: string }
  | { status: "already-there"; statusId: string }
  /**
   * Nothing was stored and no id was invented — either the capture carried no
   * status id, or this implementation has nowhere to put it. Both mean "do not
   * tell the user it was filed"; a surface that needs to explain WHICH should
   * check the capture itself rather than infer it from here.
   */
  | { status: "unsavable" };

/** One bounded page of a Folder's contents. `nextCursor` null ⇒ end of the Folder. */
export interface FolderPage {
  posts: SavedPost[];
  /** Opaque and store-minted. Callers pass it back verbatim, never construct one. */
  nextCursor: string | null;
}

export interface CreateFolderParams {
  name: string;
}
export interface ListFoldersParams {
  /** Soft-deleted Folders are out of the default listing. */
  includeDeleted?: boolean;
}
export interface RenameFolderParams {
  folderId: string;
  name: string;
}
export interface ReorderFoldersParams {
  /** The new order. Folders absent from the list keep their relative position after it. */
  folderIds: string[];
}
export interface DeleteFolderParams {
  folderId: string;
  disposition: FolderDisposition;
}
export interface SavePostParams {
  folderId: string;
  capture: PostCapture;
}
export interface RemoveFromFolderParams {
  folderId: string;
  statusId: string;
}
export interface DeleteSavedPostParams {
  statusId: string;
}
export interface GetSavedPostParams {
  statusId: string;
}
export interface SetNoteParams {
  statusId: string;
  note: string;
}
export interface SetTagsParams {
  statusId: string;
  tags: string[];
}
/**
 * The row IS the parameter: one observation, recorded as given. Aliased rather
 * than restated so the two can never drift apart.
 */
export type RecordBookmarkEvidenceParams = BookmarkEvidence;
export interface ListBookmarkEvidenceParams {
  statusId: string;
}
export interface CountFolderParams {
  folderId: string;
}
export interface ReadFolderPageParams {
  folderId: string;
  limit: number;
  /** A `nextCursor` from a previous page. Omit for the first page. */
  cursor?: string | null;
}

/**
 * The storage seam behind Folders — one contract, several implementations: the
 * local database now, a Convex, Notion or Airtable Destination later. Sibling of
 * `MembershipStore`. Every operation takes a single parameter object, and no
 * operation takes an account.
 */
export interface CollectionStore {
  createFolder(params: CreateFolderParams): Promise<Folder>;
  listFolders(params: ListFoldersParams): Promise<Folder[]>;
  renameFolder(params: RenameFolderParams): Promise<void>;
  reorderFolders(params: ReorderFoldersParams): Promise<void>;
  /** Soft-deletes the Folder and applies `disposition` to the posts it held. */
  deleteFolder(params: DeleteFolderParams): Promise<void>;

  savePost(params: SavePostParams): Promise<SaveOutcome>;
  /** Unfiling, never deleting: the post stays in every other Folder. */
  removeFromFolder(params: RemoveFromFolderParams): Promise<void>;
  /** Terminal: takes the post's Folder rows and bookmark evidence with it. */
  deleteSavedPost(params: DeleteSavedPostParams): Promise<void>;
  getSavedPost(params: GetSavedPostParams): Promise<SavedPost | null>;

  setNote(params: SetNoteParams): Promise<void>;
  setTags(params: SetTagsParams): Promise<void>;

  /**
   * One row per account: a second account appends beside the first, and a fresh
   * observation for an account it already has REPLACES that account's row. The
   * row is the latest reading of one account's state, so a retry that now
   * confirms must not leave an earlier `failed` standing.
   */
  recordBookmarkEvidence(params: RecordBookmarkEvidenceParams): Promise<void>;
  listBookmarkEvidence(params: ListBookmarkEvidenceParams): Promise<BookmarkEvidence[]>;

  /** Index-backed, never a scan. */
  countFolder(params: CountFolderParams): Promise<number>;
  /** Distinct posts, deduped by status id. Index-backed, never a scan. */
  countSavedPosts(): Promise<number>;
  /** A bounded, ordered page. Never reads a whole Folder into memory. */
  readFolderPage(params: ReadFolderPageParams): Promise<FolderPage>;
}
