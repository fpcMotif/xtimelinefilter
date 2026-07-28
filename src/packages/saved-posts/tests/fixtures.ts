import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

import { createCollectionStore } from "../index";
import type { CollectionStore, PostCapture } from "../types";

/**
 * Shared fixtures for this package's suites. `IDBFactory` and `IDBKeyRange`
 * travel together everywhere — ranges must come from the same implementation as
 * the database — so the pairing lives here once rather than at every call site.
 */

/** A store over a database of its own, so suites never share state. */
export const freshStore = (): Promise<CollectionStore> =>
  createCollectionStore({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange });

/** A store with no database at all — the inert one. */
export const inertStore = (): Promise<CollectionStore> => createCollectionStore({});

/** A fully-populated capture. `over` narrows it for the partial-capture cases. */
export const capture = (statusId: string | null, over: Partial<PostCapture> = {}): PostCapture => ({
  statusId,
  permalink: statusId ? `https://x.com/jack/status/${statusId}` : null,
  author: { screenName: "jack", userId: "12" },
  text: `post ${statusId}`,
  media: [{ kind: "photo", url: "a.jpg" }],
  postedAt: "2026-07-20T10:00:00.000Z",
  ...over,
});
