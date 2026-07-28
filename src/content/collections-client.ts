import type { CacheObservation } from "@/core/cache-observation";
import { requestCollections, type DefaultSaveOutcome } from "@/core/protocol/collections";
import type { PostCapture } from "@/packages/folders/types";

/**
 * The page's narrow door to Folders. Every call is one worker round-trip: the
 * content script never reads the default-Folder setting or lists Folders to
 * decide where to file — the worker resolves that inside one operation, so two
 * fast presses cannot race into two Folders.
 *
 * No method takes an account, and none is available to pass: a Folder has no
 * Owner, so the gesture fires identically on every X account and with none.
 */
export interface CollectionsClient {
  /** Resolve the default Folder and file this post into it. */
  saveToDefaultFolder(capture: PostCapture): Promise<DefaultSaveOutcome>;
  /** Reverse exactly what one save wrote — and nothing it did not. */
  undoSave(save: SavedByGesture): Promise<void>;
}

/** What a single save gesture created, which is all Undo may take back. */
export interface SavedByGesture {
  folderId: string;
  statusId: string;
  /** True only when THIS gesture minted the Saved Post row. */
  createdSavedPost: boolean;
}

const TYPE = "lasso:collections";

/**
 * A fence minted at the start of each gesture, refused if Clear intervenes.
 *
 * The casts here are safe because `requestCollections` IS the validator: it
 * re-checks every response against the operation's exact key set and throws
 * before returning, so a narrowing guard on top would be unreachable.
 */
async function token() {
  const response = (await requestCollections({ type: TYPE, operation: "begin" })) as {
    token: CacheObservation;
  };
  return response.token;
}

export function createCollectionsClient(): CollectionsClient {
  return {
    async saveToDefaultFolder(capture) {
      const response = (await requestCollections({
        type: TYPE,
        operation: "save-to-default-folder",
        capture,
        token: await token(),
      })) as { defaultSave: DefaultSaveOutcome };
      return response.defaultSave;
    },

    async undoSave({ folderId, statusId, createdSavedPost }) {
      // ONE fence for the whole undo. Both legs are a single gesture, so minting
      // a second token would not only cost a round-trip — it could put the two
      // legs on opposite sides of a Privacy Clear, unfiling the post but leaving
      // it behind.
      const fence = await token();
      // Unfile first. Deleting the post would take its Folder rows with it,
      // including rows in Folders this gesture never touched.
      await requestCollections({
        type: TYPE,
        operation: "remove-from-folder",
        folderId,
        statusId,
        token: fence,
      });
      // The post itself goes only when this gesture minted it: a post already
      // saved elsewhere keeps its other Folder rows, note, tags and captured-at.
      if (createdSavedPost) {
        await requestCollections({
          type: TYPE,
          operation: "delete-saved-post",
          statusId,
          token: fence,
        });
      }
    },
  };
}
