/**
 * Cross-context change bridge. The background owns Chrome storage and relays
 * public transitions over runtime messaging, so content scripts never need raw
 * storage access. `watchStorageKey` closes each in-memory mirror's gap.
 *
 * Unit and non-extension hosts without runtime listeners retain the raw-storage
 * fallback. Callers can therefore wire it unconditionally.
 */
import { isStorageChangedMessage } from "@/core/protocol";

export interface StorageKeyChange {
  oldValue: unknown;
  newValue: unknown;
}

interface BackgroundSenderIdentity {
  url: string;
  origin: string;
}

function backgroundSenderIdentity(runtime: typeof chrome.runtime): BackgroundSenderIdentity | null {
  try {
    const background = runtime.getManifest().background;
    const route =
      background && "service_worker" in background ? background.service_worker : undefined;
    if (typeof route !== "string" || route.length === 0) return null;
    const url = runtime.getURL(route);
    const parsed = new URL(url);
    return { url, origin: `${parsed.protocol}//${parsed.host}` };
  } catch {
    return null;
  }
}

export function watchStorageKey(
  areaName: "sync" | "local",
  key: string,
  onChange: (change: StorageKeyChange) => void,
): () => void {
  try {
    const extension = (globalThis as { chrome?: typeof chrome }).chrome;
    const runtimeMessages = extension?.runtime?.onMessage;
    const runtimeId = extension?.runtime?.id;
    const worker = extension?.runtime ? backgroundSenderIdentity(extension.runtime) : null;
    if (runtimeMessages?.addListener && typeof runtimeId === "string" && worker) {
      const listener = (message: unknown, sender: chrome.runtime.MessageSender): void => {
        const fromWorker =
          sender.id === runtimeId &&
          sender.url === worker.url &&
          sender.tab === undefined &&
          sender.frameId === undefined &&
          sender.documentId === undefined &&
          (sender.origin === undefined || sender.origin === worker.origin);
        if (
          fromWorker &&
          isStorageChangedMessage(message) &&
          message.area === areaName &&
          message.key === key
        ) {
          onChange({ oldValue: message.oldValue, newValue: message.newValue });
        }
      };
      runtimeMessages.addListener(listener);
      return () => runtimeMessages.removeListener?.(listener);
    }

    const onChanged = extension?.storage?.onChanged;
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
