/**
 * The Folder id format, on its own entry point so a wire validator can check it
 * without importing the store. `index.ts` pulls in the IndexedDB implementation;
 * the protocol layer is loaded by content, options and the popup, none of which
 * may carry that code.
 */
export { FOLDER_ID_RE } from "./lib/ids";
