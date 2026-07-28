/**
 * The database's declared identity, on a store-free entry point. `index.ts`
 * pulls in the IndexedDB implementation; `core/storage-keys` names the database
 * so Privacy Clear has one list to consult, and it must not drag the store into
 * content, options and the popup to do it.
 */
export { FOLDERS_DB_NAME, FOLDERS_DB_VERSION } from "./lib/schema";
