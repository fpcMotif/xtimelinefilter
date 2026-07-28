/**
 * saved-posts — the storage brain behind Folders. Headless and standalone: it
 * knows nothing about Chrome, the DOM, x.com, the worker or any surface, which
 * is why it declares `PostCapture` itself (see ./types) rather than importing it
 * from the read package.
 *
 * The domain and the `CollectionStore` contract live on ./types; this entry
 * point exposes the factory plus the two things about the store that are
 * declared rather than incidental — the database's name and version, and the
 * shape of a Folder id, which is minted here and by nobody else.
 */
import { LocalCollectionStore, openDatabase } from "./lib/local-store";
import { NullCollectionStore } from "./lib/null-store";
import type { CollectionStore } from "./types";

export { SAVED_POSTS_DB_NAME, SAVED_POSTS_DB_VERSION } from "./lib/schema";
export { FOLDER_ID_RE } from "./lib/ids";

export interface CollectionStoreConfig {
  /** The database to open. Absent ⇒ the null object. Never read from a global. */
  indexedDB?: IDBFactory;
  /** Key ranges must come from the same implementation as `indexedDB`. */
  keyRange?: typeof IDBKeyRange;
}

/**
 * The only place that names a concrete implementation (sibling of
 * `createMembershipStore`). It chooses from its arguments alone — no account, no
 * Chrome API, no ambient state. A host with no database, or a database that
 * refuses to open, degrades to the inert null object rather than throwing, so an
 * unavailable store is never the difference between working and crashing.
 */
export async function createCollectionStore(
  config: CollectionStoreConfig,
): Promise<CollectionStore> {
  const { indexedDB, keyRange } = config;
  if (!indexedDB || !keyRange) return new NullCollectionStore();
  try {
    return new LocalCollectionStore(await openDatabase(indexedDB), keyRange);
  } catch {
    return new NullCollectionStore();
  }
}
