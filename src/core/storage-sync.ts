/**
 * Cross-context change bridge. `chrome.storage.sync`/`local` writes are visible
 * to every extension context (popup, Options, sibling content scripts), but each
 * context holds its own in-memory mirror — so an edit in one is invisible to the
 * others until they reload. `watchStorageKey` closes that gap: it invokes
 * `onChange` whenever a context changes `key` in `areaName`.
 *
 * A no-op when `chrome.storage.onChanged` is absent (unit tests under happy-dom,
 * the e2e harness, plain web pages), so callers can wire it unconditionally.
 */
export interface StorageKeyChange {
  oldValue: unknown;
  newValue: unknown;
}

export function watchStorageKey(
  areaName: "sync" | "local",
  key: string,
  onChange: (change: StorageKeyChange) => void,
): () => void {
  try {
    const onChanged = (globalThis as { chrome?: typeof chrome }).chrome?.storage?.onChanged;
    if (!onChanged?.addListener) return () => {};
    const listener = (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      area: string,
    ): void => {
      if (area === areaName && Object.prototype.hasOwnProperty.call(changes, key)) {
        onChange({
          oldValue: changes[key]?.oldValue,
          newValue: changes[key]?.newValue,
        });
      }
    };
    onChanged.addListener(listener);
    return () => onChanged.removeListener?.(listener);
  } catch {
    // Extension context torn down (reload) or storage unavailable — never throw.
    return () => {};
  }
}
