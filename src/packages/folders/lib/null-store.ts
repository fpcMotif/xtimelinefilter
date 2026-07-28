import type {
  BookmarkEvidence,
  CollectionStore,
  CreateFolderParams,
  Folder,
  FolderPage,
  SaveOutcome,
  SavedPost,
} from "../types";
import { mintFolderId } from "./ids";

/**
 * Folders with nowhere to put them: every write is a no-op, every read is empty,
 * every count is zero. This is what a host with no database gets, so the rest of
 * the extension behaves exactly as if the feature were absent rather than broken.
 *
 * `createFolder` still answers with a well-formed Folder — the contract promises
 * the shape of the answer, not that the answer was persisted — and `listFolders`
 * will not contain it.
 */
export class NullCollectionStore implements CollectionStore {
  async createFolder({ name }: CreateFolderParams): Promise<Folder> {
    const now = Date.now();
    return {
      folderId: mintFolderId(),
      name,
      sortIndex: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }
  async listFolders(): Promise<Folder[]> {
    return [];
  }
  async renameFolder(): Promise<void> {}
  async reorderFolders(): Promise<void> {}
  async deleteFolder(): Promise<void> {}

  async savePost(): Promise<SaveOutcome> {
    return { status: "unsavable" };
  }
  async removeFromFolder(): Promise<void> {}
  async deleteSavedPost(): Promise<void> {}
  async getSavedPost(): Promise<SavedPost | null> {
    return null;
  }
  async foldersHolding(): Promise<string[]> {
    return [];
  }

  async setNote(): Promise<void> {}
  async setTags(): Promise<void> {}

  async recordBookmarkEvidence(): Promise<void> {}
  async listBookmarkEvidence(): Promise<BookmarkEvidence[]> {
    return [];
  }

  async countFolder(): Promise<number> {
    return 0;
  }
  async countSavedPosts(): Promise<number> {
    return 0;
  }
  async readFolderPage(): Promise<FolderPage> {
    return { posts: [], nextCursor: null };
  }
}
