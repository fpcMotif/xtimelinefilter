import { describe, expect, it } from "vitest";

import type {
  BookmarkEvidence,
  CollectionStore,
  CountFolderParams,
  CreateFolderParams,
  DeleteFolderParams,
  DeleteSavedPostParams,
  Folder,
  FolderMembership,
  FoldersHoldingParams,
  GetSavedPostParams,
  ListBookmarkEvidenceParams,
  ListFoldersParams,
  PostCapture,
  ReadFolderPageParams,
  RecordBookmarkEvidenceParams,
  RemoveFromFolderParams,
  RenameFolderParams,
  ReorderFoldersParams,
  SavePostParams,
  SavedPost,
  SetNoteParams,
  SetTagsParams,
} from "../types";
import { inertStore } from "./fixtures";

/**
 * Account-freedom checked by DECLARED SHAPE, not by field name. Each assertion
 * below pins a type's key set to an exact literal list, so adding
 * `ownerUserId`, `xAccountId`, `accountId`, `twid` or a signed-in handle
 * anywhere breaks the equality — and renaming the field does not evade it,
 * because it is the whole key SET that must match.
 *
 * These are compile-time assertions enforced by `bun run typecheck`, which
 * already compiles `src/`. A red bar here shows up as a type error, not a
 * failing expectation.
 */

/** True only when T's keys are exactly K — mutual assignability, both ways. */
type KeysAre<T, K extends PropertyKey> = [keyof T] extends [K]
  ? [K] extends [keyof T]
    ? true
    : false
  : false;

function pin<_Assert extends true>(): void {}

// --- the operation set itself: no account-shaped operation may be added ------
pin<
  KeysAre<
    CollectionStore,
    | "createFolder"
    | "listFolders"
    | "renameFolder"
    | "reorderFolders"
    | "deleteFolder"
    | "savePost"
    | "removeFromFolder"
    | "deleteSavedPost"
    | "getSavedPost"
    | "foldersHolding"
    | "setNote"
    | "setTags"
    | "recordBookmarkEvidence"
    | "listBookmarkEvidence"
    | "countFolder"
    | "countFolderShared"
    | "countFolders"
    | "countSavedPosts"
    | "readFolderPage"
    | "close"
  >
>();

// --- every operation's parameter object --------------------------------------
pin<KeysAre<CreateFolderParams, "name">>();
pin<KeysAre<ListFoldersParams, "includeDeleted">>();
pin<KeysAre<RenameFolderParams, "folderId" | "name">>();
pin<KeysAre<ReorderFoldersParams, "folderIds">>();
pin<KeysAre<DeleteFolderParams, "folderId" | "disposition">>();
pin<KeysAre<SavePostParams, "folderId" | "capture">>();
pin<KeysAre<RemoveFromFolderParams, "folderId" | "statusId">>();
pin<KeysAre<DeleteSavedPostParams, "statusId">>();
pin<KeysAre<GetSavedPostParams, "statusId">>();
pin<KeysAre<FoldersHoldingParams, "statusId">>();
pin<KeysAre<SetNoteParams, "statusId" | "note">>();
pin<KeysAre<SetTagsParams, "statusId" | "tags">>();
pin<KeysAre<ListBookmarkEvidenceParams, "statusId">>();
pin<KeysAre<CountFolderParams, "folderId">>();
pin<KeysAre<ReadFolderPageParams, "folderId" | "limit" | "cursor">>();
// The one parameter object that may name an account.
pin<KeysAre<RecordBookmarkEvidenceParams, "statusId" | "xAccountId" | "outcome" | "observedAt">>();

// --- every stored record ------------------------------------------------------
// This one pin is load-bearing TWICE. Besides account-freedom it is the whole
// enforcement of ADR-0013's flat-Folders amendment: a Folder holds Saved Posts
// and never another Folder, so a `parentFolderId`, `parentId`, `path`, `depth`
// or `children` field — under any name — must fail here, at typecheck. Because
// the domain type cannot express a parent, nothing downstream can render a tree
// or push one to a Destination, which is why flatness needs no other guard.
// Widening this list is a reversal of ADR-0013, not a test edit.
pin<KeysAre<Folder, "folderId" | "name" | "sortIndex" | "createdAt" | "updatedAt" | "deletedAt">>();
pin<
  KeysAre<
    SavedPost,
    | "statusId"
    | "permalink"
    | "author"
    | "text"
    | "media"
    | "postedAt"
    | "capturedAt"
    | "note"
    | "tags"
  >
>();
pin<KeysAre<FolderMembership, "folderId" | "statusId" | "addedAt">>();
// The one record that may name an account, and it names it as an observation's
// attribute rather than as any post's or Folder's identity.
pin<KeysAre<BookmarkEvidence, "statusId" | "xAccountId" | "outcome" | "observedAt">>();

// --- the capture the store accepts -------------------------------------------
pin<KeysAre<PostCapture, "statusId" | "permalink" | "author" | "text" | "media" | "postedAt">>();
pin<KeysAre<NonNullable<PostCapture["author"]>, "screenName" | "userId">>();

describe("account freedom", () => {
  it("the equality type rejects a key set that gained an account field", () => {
    // Guards the guard: if KeysAre were satisfied by a superset, every pin above
    // would be vacuous and an added `ownerUserId` would sail through.
    type Widened = Folder & { ownerUserId: string };
    const exact: KeysAre<Folder, keyof Folder> = true;
    const widened: KeysAre<Widened, keyof Folder> = false;
    const narrowed: KeysAre<Pick<Folder, "folderId">, keyof Folder> = false;
    expect([exact, widened, narrowed]).toEqual([true, false, false]);
  });

  it("ships exactly the declared operations and no others", async () => {
    // Read off a REAL implementation's prototype, not a list written here — an
    // added `savePostForAccount` has to fail something that inspects the code.
    //
    // The spec's "same post while a different X account is signed in" case is
    // deliberately NOT claimed by this package: with no account parameter on any
    // operation below, such a test would silently degenerate into plain
    // idempotence. It belongs to the tickets that own a current-account seam.
    const store = await inertStore();
    const shipped = Object.getOwnPropertyNames(Object.getPrototypeOf(store))
      .filter((name) => name !== "constructor")
      .toSorted();
    expect(shipped).toEqual(
      [
        "close",
        "countFolder",
        "countFolderShared",
        "countFolders",
        "countSavedPosts",
        "createFolder",
        "deleteFolder",
        "deleteSavedPost",
        "foldersHolding",
        "getSavedPost",
        "listBookmarkEvidence",
        "listFolders",
        "readFolderPage",
        "recordBookmarkEvidence",
        "removeFromFolder",
        "renameFolder",
        "reorderFolders",
        "savePost",
        "setNote",
        "setTags",
      ].toSorted(),
    );
  });
});
