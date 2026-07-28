/**
 * Every key Lasso writes, named in one place. Privacy clear removes user data;
 * the migration tombstone remains so legacy sync data cannot resurrect it.
 */
export const STORAGE_KEYS = {
  /** chrome.storage.local — cached Lists */
  lists: "lasso:lists",
  /** chrome.storage.local — per-List pick counts/recency */
  listUsage: "lasso:list-usage",
  /** chrome.storage.local — user settings; background/data-lifecycle migrates the legacy sync copy */
  settings: "lasso:settings",
  /** chrome.storage.local — non-user control state: pending | complete | cleared */
  settingsMigration: "lasso:settings-migration",
  /** chrome.storage.sync — the one global timeline filter (createFilterStore) */
  filter: "lasso:filter",
  /** chrome.storage.local — onboarding + decaying-hint state */
  coach: "lasso:coach",
  /** chrome.storage.local — last Mirror write outcome ({ok, at}; popup's Mirror row) */
  mirrorStatus: "lasso:mirror-status",
  /** chrome.storage.local — versioned X GraphQL operation-id cache; legacy literal is retained. */
  graphqlOps: "lasso.graphqlOps.v1",
  /** chrome.storage.local — complete, metadata-compatible X GraphQL operation catalog. */
  graphqlCatalog: "lasso.graphqlCatalog.v2",
  /** chrome.storage.local — private global fence for asynchronous cache observations. */
  cacheObservation: "lasso:cache-observation",
  /**
   * chrome.storage.local — RESERVED for the Destination tokens a later ticket
   * writes (Notion, Airtable). Registered now, empty, so Privacy Clear already
   * sweeps it: a new prefixed key added later would otherwise escape the sweep
   * until somebody remembered to add it. Deliberately NOT a LassoSettings field,
   * so the popup's Settings read grant cannot reach a token.
   */
  destinationSecrets: "lasso:destination-secrets",
} as const;

/**
 * The worker-owned IndexedDB database holding Folders, Saved Posts, membership
 * rows, bookmark evidence and Destination sync state. Not a chrome.storage key —
 * it is named here so Privacy Clear has one list to consult, and a test pins it
 * equal to the folders package's own FOLDERS_DB_NAME.
 */
export const COLLECTIONS_DATABASE = "lasso:folders";

export const LOCAL_STORAGE_KEYS = [
  STORAGE_KEYS.lists,
  STORAGE_KEYS.listUsage,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.coach,
  STORAGE_KEYS.mirrorStatus,
  STORAGE_KEYS.graphqlOps,
  STORAGE_KEYS.graphqlCatalog,
  STORAGE_KEYS.destinationSecrets,
];
// settings stays here too so Clear also wipes any pre-local legacy copy.
export const SYNC_STORAGE_KEYS = [STORAGE_KEYS.filter, STORAGE_KEYS.settings];

export type ManagedStorageArea = "local" | "sync";

/** Only these transitions need reactive fanout. Cache data is pull-read. */
export function isReactiveStorageKey(area: ManagedStorageArea, key: string): boolean {
  return (
    (area === "local" && (key === STORAGE_KEYS.settings || key === STORAGE_KEYS.mirrorStatus)) ||
    (area === "sync" && key === STORAGE_KEYS.filter)
  );
}
