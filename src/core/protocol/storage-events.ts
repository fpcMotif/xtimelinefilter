export interface StorageChangedMessage {
  type: "lasso:storage-changed";
  area: "local" | "sync";
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

export function isStorageChangedMessage(msg: unknown): msg is StorageChangedMessage {
  if (typeof msg !== "object" || msg === null || !("type" in msg)) return false;
  const value = msg as Record<string, unknown>;
  return (
    value.type === "lasso:storage-changed" &&
    (value.area === "local" || value.area === "sync") &&
    typeof value.key === "string" &&
    ((value.area === "local" &&
      (value.key === "lasso:settings" || value.key === "lasso:mirror-status")) ||
      (value.area === "sync" && value.key === "lasso:filter")) &&
    "oldValue" in value &&
    "newValue" in value
  );
}
