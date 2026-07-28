import { isCacheObservation, type CacheObservation } from "@/core/cache-observation";
import { isXId } from "@/core/protocol/x-id";
import { FOLDER_ID_RE } from "@/packages/folders/ids";
import type {
  BookmarkEvidence,
  BookmarkOutcome,
  Folder,
  FolderDisposition,
  FolderPage,
  PostCapture,
  SaveOutcome,
  SavedPost,
} from "@/packages/folders/types";

/**
 * The `lasso:collections` worker family — the only way any surface reaches
 * Folders. Its operations mirror the `CollectionStore` contract one-for-one,
 * plus two count reads the picker, Options and the popup all render.
 *
 * Two properties are enforced by the SHAPE of these messages, not by a rule a
 * caller has to remember:
 *
 * **Account-free.** No request or response carries an Owner, an `ownerUserId` or
 * a screen name. The single field in the family that may hold an X account id is
 * `xAccountId` on the bookmark-evidence write, where it is an attribute of an
 * observation. Every message is validated by EXACT key set, so an account field
 * added under any name makes an otherwise-valid message invalid — a rename does
 * not evade it.
 *
 * **Saved-once.** No operation can produce a second Saved Post for one status
 * id: filing into a second Folder adds a membership row, and re-filing where the
 * post already sits answers `already-there` without writing.
 *
 * Writes carry an observation token minted by `begin`, so a write the user
 * started before Privacy Clear cannot land after it (the same fence the List and
 * GraphQL caches use). Reads need no token — a stale read returns stale data,
 * which is harmless; a stale write would resurrect deleted data.
 */

// --- declared bounds ---------------------------------------------------------
// Every string and array on the wire has one. Exported so the surfaces that
// build these messages can stop the user at the limit rather than submitting a
// write that will be rejected.

/** Matches the X List-name bound `list-cache.ts` already applies. */
export const MAX_FOLDER_NAME = 100;
/** Live (non-deleted) Folders. Options disables its create control here. */
export const MAX_LIVE_FOLDERS = 200;
export const MAX_FOLDER_ID = 64;
export const MAX_NOTE = 2000;
export const MAX_TAGS = 32;
export const MAX_TAG = 48;
/** An X Premium post; the capture keeps what was rendered. */
export const MAX_POST_TEXT = 25_000;
export const MAX_MEDIA = 8;
export const MAX_URL = 2048;
export const MAX_SCREEN_NAME = 20;
export const MAX_POSTED_AT = 64;
export const MAX_PAGE_LIMIT = 100;
export const MAX_CURSOR = 128;
export const MAX_X_ACCOUNT_ID = 64;

const TYPE = "lasso:collections";

export type CollectionsOperation =
  | "begin"
  | "list-folders"
  | "folders-holding"
  | "create-folder"
  | "rename-folder"
  | "reorder-folders"
  | "delete-folder"
  | "save-post"
  | "remove-from-folder"
  | "delete-saved-post"
  | "get-saved-post"
  | "set-note"
  | "set-tags"
  | "record-bookmark-evidence"
  | "list-bookmark-evidence"
  | "count-folder"
  | "counts"
  | "read-folder-page";

/** Every operation name, in one place, so a capability table can be exhaustive. */
export const COLLECTIONS_OPERATIONS: readonly CollectionsOperation[] = [
  "begin",
  "list-folders",
  "folders-holding",
  "create-folder",
  "rename-folder",
  "reorder-folders",
  "delete-folder",
  "save-post",
  "remove-from-folder",
  "delete-saved-post",
  "get-saved-post",
  "set-note",
  "set-tags",
  "record-bookmark-evidence",
  "list-bookmark-evidence",
  "count-folder",
  "counts",
  "read-folder-page",
] as const;

/** The operations that change data, and so must carry a Clear fence. */
export const COLLECTIONS_WRITES: readonly CollectionsOperation[] = [
  "create-folder",
  "rename-folder",
  "reorder-folders",
  "delete-folder",
  "save-post",
  "remove-from-folder",
  "delete-saved-post",
  "set-note",
  "set-tags",
  "record-bookmark-evidence",
] as const;

export type CollectionsRequest =
  | { type: typeof TYPE; operation: "begin" }
  | { type: typeof TYPE; operation: "list-folders"; includeDeleted: boolean }
  | { type: typeof TYPE; operation: "folders-holding"; statusId: string }
  | { type: typeof TYPE; operation: "create-folder"; name: string; token: CacheObservation }
  | {
      type: typeof TYPE;
      operation: "rename-folder";
      folderId: string;
      name: string;
      token: CacheObservation;
    }
  | {
      type: typeof TYPE;
      operation: "reorder-folders";
      folderIds: string[];
      token: CacheObservation;
    }
  | {
      type: typeof TYPE;
      operation: "delete-folder";
      folderId: string;
      disposition: FolderDisposition;
      token: CacheObservation;
    }
  | {
      type: typeof TYPE;
      operation: "save-post";
      folderId: string;
      capture: PostCapture;
      token: CacheObservation;
    }
  | {
      type: typeof TYPE;
      operation: "remove-from-folder";
      folderId: string;
      statusId: string;
      token: CacheObservation;
    }
  | {
      type: typeof TYPE;
      operation: "delete-saved-post";
      statusId: string;
      token: CacheObservation;
    }
  | { type: typeof TYPE; operation: "get-saved-post"; statusId: string }
  | {
      type: typeof TYPE;
      operation: "set-note";
      statusId: string;
      note: string;
      token: CacheObservation;
    }
  | {
      type: typeof TYPE;
      operation: "set-tags";
      statusId: string;
      tags: string[];
      token: CacheObservation;
    }
  | {
      type: typeof TYPE;
      operation: "record-bookmark-evidence";
      statusId: string;
      /** The ONE account-bearing field in this family. */
      xAccountId: string;
      outcome: BookmarkOutcome;
      observedAt: number;
      token: CacheObservation;
    }
  | { type: typeof TYPE; operation: "list-bookmark-evidence"; statusId: string }
  | { type: typeof TYPE; operation: "count-folder"; folderId: string }
  | { type: typeof TYPE; operation: "counts" }
  | {
      type: typeof TYPE;
      operation: "read-folder-page";
      folderId: string;
      limit: number;
      cursor: string | null;
    };

/** Folder count is bounded by MAX_LIVE_FOLDERS; posts is the deduped total. */
export interface CollectionCounts {
  folders: number;
  savedPosts: number;
}

export type CollectionsSuccess =
  | { token: CacheObservation }
  | { folders: Folder[] }
  | { folderIds: string[] }
  | { folder: Folder }
  | { outcome: SaveOutcome }
  | { post: SavedPost | null }
  | { evidence: BookmarkEvidence[] }
  | { count: number }
  | { counts: CollectionCounts }
  | { page: FolderPage }
  | Record<string, never>;

export type CollectionsResponse =
  | ({ ok: true } & CollectionsSuccess)
  | { ok: false; error: string };

// --- shared primitives -------------------------------------------------------

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Code points, not UTF-16 units — an emoji must not cost a user two characters. */
const atMost = (value: string, max: number): boolean => {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > max) return false;
  }
  return true;
};

const boundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && atMost(value, max);

const nonEmpty = (value: unknown, max: number): value is string =>
  boundedString(value, max) && value.trim().length > 0;

const folderId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_FOLDER_ID && FOLDER_ID_RE.test(value);

const boundedArray = (value: unknown, max: number): value is unknown[] =>
  Array.isArray(value) && value.length <= max;

const keysAre = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};

const nonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isOutcome = (value: unknown): value is BookmarkOutcome =>
  value === "confirmed" || value === "failed" || value === "skipped";

const isDisposition = (value: unknown): value is FolderDisposition =>
  value === "keep-posts" || value === "delete-orphaned-posts";

const isMedia = (value: unknown): boolean =>
  record(value) &&
  (value.kind === "photo" || value.kind === "video") &&
  (keysAre(value, ["kind"]) ||
    (keysAre(value, ["kind", "url"]) && boundedString(value.url, MAX_URL)));

const isAuthor = (value: unknown): boolean =>
  record(value) &&
  nonEmpty(value.screenName, MAX_SCREEN_NAME) &&
  (keysAre(value, ["screenName"]) ||
    (keysAre(value, ["screenName", "userId"]) && isXId(value.userId)));

/**
 * The capture as it crosses the boundary. `statusId` may be null — the reader
 * says so when X exposed no durable identity — and the worker answers
 * `unsavable` rather than inventing one.
 */
const isCapture = (value: unknown): value is PostCapture => {
  if (!record(value)) return false;
  const optional = ["author", "text", "postedAt"] as const;
  const allowed = new Set(["statusId", "permalink", "media", ...optional]);
  if (!Object.keys(value).every((key) => allowed.has(key))) return false;
  if (!Object.hasOwn(value, "statusId") || !Object.hasOwn(value, "permalink")) return false;
  if (!Object.hasOwn(value, "media")) return false;
  if (value.statusId !== null && !isXId(value.statusId)) return false;
  if (value.permalink !== null && !boundedString(value.permalink, MAX_URL)) return false;
  if (!boundedArray(value.media, MAX_MEDIA) || !value.media.every(isMedia)) return false;
  if (Object.hasOwn(value, "author") && !isAuthor(value.author)) return false;
  if (Object.hasOwn(value, "text") && !boundedString(value.text, MAX_POST_TEXT)) return false;
  if (Object.hasOwn(value, "postedAt") && !boundedString(value.postedAt, MAX_POSTED_AT))
    return false;
  return true;
};

/** Exact key set per operation. `token` is present exactly on the writes. */
const REQUEST_KEYS: Record<CollectionsOperation, readonly string[]> = {
  begin: ["type", "operation"],
  "list-folders": ["type", "operation", "includeDeleted"],
  "folders-holding": ["type", "operation", "statusId"],
  "create-folder": ["type", "operation", "name", "token"],
  "rename-folder": ["type", "operation", "folderId", "name", "token"],
  "reorder-folders": ["type", "operation", "folderIds", "token"],
  "delete-folder": ["type", "operation", "folderId", "disposition", "token"],
  "save-post": ["type", "operation", "folderId", "capture", "token"],
  "remove-from-folder": ["type", "operation", "folderId", "statusId", "token"],
  "delete-saved-post": ["type", "operation", "statusId", "token"],
  "get-saved-post": ["type", "operation", "statusId"],
  "set-note": ["type", "operation", "statusId", "note", "token"],
  "set-tags": ["type", "operation", "statusId", "tags", "token"],
  "record-bookmark-evidence": [
    "type",
    "operation",
    "statusId",
    "xAccountId",
    "outcome",
    "observedAt",
    "token",
  ],
  "list-bookmark-evidence": ["type", "operation", "statusId"],
  "count-folder": ["type", "operation", "folderId"],
  counts: ["type", "operation"],
  "read-folder-page": ["type", "operation", "folderId", "limit", "cursor"],
};

const isOperation = (value: unknown): value is CollectionsOperation =>
  typeof value === "string" && Object.hasOwn(REQUEST_KEYS, value);

/** Fails closed: an unknown operation, an extra key or a wrong type is rejected. */
export function isCollectionsRequest(msg: unknown): msg is CollectionsRequest {
  if (!record(msg) || msg.type !== TYPE || !isOperation(msg.operation)) return false;
  const operation = msg.operation;
  if (!keysAre(msg, REQUEST_KEYS[operation])) return false;
  // Every write is fenced; no read is.
  if (COLLECTIONS_WRITES.includes(operation) && !isCacheObservation(msg.token)) return false;

  switch (operation) {
    case "begin":
    case "counts":
      return true;
    case "list-folders":
      return typeof msg.includeDeleted === "boolean";
    case "folders-holding":
    case "get-saved-post":
    case "list-bookmark-evidence":
    case "delete-saved-post":
      return isXId(msg.statusId);
    case "create-folder":
      return nonEmpty(msg.name, MAX_FOLDER_NAME);
    case "rename-folder":
      return folderId(msg.folderId) && nonEmpty(msg.name, MAX_FOLDER_NAME);
    case "reorder-folders":
      return boundedArray(msg.folderIds, MAX_LIVE_FOLDERS) && msg.folderIds.every(folderId);
    case "delete-folder":
      return folderId(msg.folderId) && isDisposition(msg.disposition);
    case "save-post":
      return folderId(msg.folderId) && isCapture(msg.capture);
    case "remove-from-folder":
      return folderId(msg.folderId) && isXId(msg.statusId);
    case "set-note":
      return isXId(msg.statusId) && boundedString(msg.note, MAX_NOTE);
    case "set-tags":
      return (
        isXId(msg.statusId) &&
        boundedArray(msg.tags, MAX_TAGS) &&
        msg.tags.every((tag) => nonEmpty(tag, MAX_TAG))
      );
    case "record-bookmark-evidence":
      return (
        isXId(msg.statusId) &&
        nonEmpty(msg.xAccountId, MAX_X_ACCOUNT_ID) &&
        isOutcome(msg.outcome) &&
        nonNegativeInt(msg.observedAt)
      );
    case "count-folder":
      return folderId(msg.folderId);
    /* v8 ignore next -- the switch is exhaustive over CollectionsOperation; this
       arm exists only because TypeScript cannot prove it from a Record key. */
    default:
      return (
        folderId(msg.folderId) &&
        nonNegativeInt(msg.limit) &&
        msg.limit > 0 &&
        msg.limit <= MAX_PAGE_LIMIT &&
        (msg.cursor === null || boundedString(msg.cursor, MAX_CURSOR))
      );
  }
}

// --- response validation -----------------------------------------------------
// The caller re-validates before believing a response: a compromised or drifted
// worker must not be able to hand a surface a shape it will render.

const isFolder = (value: unknown): value is Folder =>
  record(value) &&
  keysAre(value, ["folderId", "name", "sortIndex", "createdAt", "updatedAt", "deletedAt"]) &&
  folderId(value.folderId) &&
  boundedString(value.name, MAX_FOLDER_NAME) &&
  nonNegativeInt(value.sortIndex) &&
  nonNegativeInt(value.createdAt) &&
  nonNegativeInt(value.updatedAt) &&
  (value.deletedAt === null || nonNegativeInt(value.deletedAt));

const isSavedPost = (value: unknown): value is SavedPost => {
  if (!record(value)) return false;
  const allowed = new Set([
    "statusId",
    "permalink",
    "author",
    "text",
    "media",
    "postedAt",
    "capturedAt",
    "note",
    "tags",
  ]);
  if (!Object.keys(value).every((key) => allowed.has(key))) return false;
  const { capturedAt, note, tags, ...capture } = value;
  return (
    isCapture({ ...capture, statusId: value.statusId }) &&
    isXId(value.statusId) &&
    nonNegativeInt(capturedAt) &&
    boundedString(note, MAX_NOTE) &&
    boundedArray(tags, MAX_TAGS) &&
    tags.every((tag) => boundedString(tag, MAX_TAG))
  );
};

const isEvidence = (value: unknown): value is BookmarkEvidence =>
  record(value) &&
  keysAre(value, ["statusId", "xAccountId", "outcome", "observedAt"]) &&
  isXId(value.statusId) &&
  nonEmpty(value.xAccountId, MAX_X_ACCOUNT_ID) &&
  isOutcome(value.outcome) &&
  nonNegativeInt(value.observedAt);

const isSaveOutcome = (value: unknown): value is SaveOutcome =>
  record(value) &&
  ((keysAre(value, ["status"]) && value.status === "unsavable") ||
    (keysAre(value, ["status", "statusId"]) &&
      (value.status === "saved" || value.status === "already-there") &&
      isXId(value.statusId)));

const isPage = (value: unknown, limit: number): value is FolderPage =>
  record(value) &&
  keysAre(value, ["posts", "nextCursor"]) &&
  boundedArray(value.posts, limit) &&
  value.posts.every(isSavedPost) &&
  (value.nextCursor === null || boundedString(value.nextCursor, MAX_CURSOR));

const isCounts = (value: unknown): value is CollectionCounts =>
  record(value) &&
  keysAre(value, ["folders", "savedPosts"]) &&
  nonNegativeInt(value.folders) &&
  value.folders <= MAX_LIVE_FOLDERS &&
  nonNegativeInt(value.savedPosts);

/** Exact key set per successful response, so a stray field is a failure. */
function validateSuccess(request: CollectionsRequest, response: Record<string, unknown>): boolean {
  const payload = { ...response };
  delete payload.ok;
  const only = (key: string, check: (value: unknown) => boolean): boolean =>
    keysAre(payload, [key]) && check(payload[key]);

  switch (request.operation) {
    case "begin":
      return only("token", isCacheObservation);
    case "list-folders":
      return only(
        "folders",
        (value) =>
          boundedArray(value, MAX_LIVE_FOLDERS * 2) && (value as unknown[]).every(isFolder),
      );
    case "folders-holding":
      return only(
        "folderIds",
        (value) => boundedArray(value, MAX_LIVE_FOLDERS) && (value as unknown[]).every(folderId),
      );
    case "create-folder":
      return only("folder", isFolder);
    case "save-post":
      return only("outcome", isSaveOutcome);
    case "get-saved-post":
      return only("post", (value) => value === null || isSavedPost(value));
    case "list-bookmark-evidence":
      return only(
        "evidence",
        (value) => boundedArray(value, 64) && (value as unknown[]).every(isEvidence),
      );
    case "count-folder":
      return only("count", nonNegativeInt);
    case "counts":
      return only("counts", isCounts);
    case "read-folder-page":
      return only("page", (value) => isPage(value, request.limit));
    default:
      // Every write answers with an acknowledgement and nothing else.
      return Object.keys(payload).length === 0;
  }
}

/**
 * Submits a collections request and re-validates the answer. A malformed,
 * extra-keyed or wrongly-typed success throws rather than being returned, and an
 * `ok:false` surfaces its error — so no caller is ever told a save landed when
 * it did not.
 */
export async function requestCollections(
  request: CollectionsRequest,
): Promise<CollectionsResponse> {
  if (!isCollectionsRequest(request)) throw new Error("Invalid collections request");
  const response: unknown = await chrome.runtime.sendMessage(request);
  if (!record(response) || typeof response.ok !== "boolean")
    throw new Error("Invalid collections response");
  if (!response.ok) {
    if (typeof response.error !== "string" || response.error.length === 0)
      throw new Error("Invalid collections response");
    throw new Error(response.error);
  }
  if (!validateSuccess(request, response)) throw new Error("Invalid collections response");
  return response as CollectionsResponse;
}
