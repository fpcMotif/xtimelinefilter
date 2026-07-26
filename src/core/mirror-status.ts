import { requestMirrorStatus } from "@/core/protocol";
import { STORAGE_KEYS } from "@/core/storage-keys";
import { watchStorageKey } from "@/core/storage-sync";

/**
 * The Mirror's observable heartbeat (ADR-0009 stays intact: never load-bearing).
 * The content script reports the last recordAssign outcome to the worker; it
 * persists STORAGE_KEYS.mirrorStatus and the popup renders it so
 * "is my Convex Mirror actually syncing?" is answered instantly instead of via a
 * once-only console.warn nobody sees.
 */
export interface MirrorStatus {
  ok: boolean;
  /** epoch ms when the write settled. */
  at: number;
  /** Opaque identity of the exact Mirror configuration used by this write. */
  configId: string;
}

/** Parse a storage.local value into a MirrorStatus; anything malformed ⇒ null. */
export function parseMirrorStatus(raw: unknown): MirrorStatus | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { ok, at, configId } = raw as Record<string, unknown>;
  if (
    typeof ok !== "boolean" ||
    typeof at !== "number" ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    typeof configId !== "string" ||
    configId.trim().length === 0 ||
    [...configId].length > 256
  )
    return null;
  return { ok, at, configId };
}

/** "just now" / "3m ago" / "2h ago" — the popup's as-of cue. */
export function mirrorAgeLabel(at: number, now: number): string {
  const mins = Math.floor(Math.max(0, now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export interface MirrorStatusStore {
  /** Publishes the last write outcome; fail-soft — never throws (ADR-0009: never load-bearing). */
  publish(outcome: { ok: boolean; configId: string }): Promise<void>;
  /** The last published status, or null when unset/unavailable/malformed. */
  read(): Promise<MirrorStatus | null>;
  /** Watch accepted local-storage status changes. */
  subscribe(cb: (status: MirrorStatus | null) => void): () => void;
}

/** Worker-owned Mirror operations. Fakes model status delivery, never storage. */
export interface MirrorStatusPort {
  report(outcome: { ok: boolean; configId: string }): Promise<void>;
  read(): Promise<MirrorStatus | null>;
  subscribe(cb: (status: MirrorStatus | null) => void): () => void;
}

export function createWorkerMirrorStatusPort(): MirrorStatusPort {
  const key = STORAGE_KEYS.mirrorStatus;
  return {
    async report(outcome) {
      await requestMirrorStatus({
        type: "lasso:mirror-status",
        operation: "report",
        ...outcome,
      });
    },
    async read() {
      const response = await requestMirrorStatus({
        type: "lasso:mirror-status",
        operation: "read",
      });
      return "status" in response && response.status !== undefined ? response.status : null;
    },
    subscribe(cb) {
      return watchStorageKey("local", key, ({ newValue }) => cb(parseMirrorStatus(newValue)));
    },
  };
}

export function createMirrorStatusStore(
  port: MirrorStatusPort = createWorkerMirrorStatusPort(),
): MirrorStatusStore {
  const subscribers = new Set<(status: MirrorStatus | null) => void>();
  let stopWatching: (() => void) | undefined;
  return {
    async publish(outcome) {
      try {
        await port.report(outcome);
      } catch {
        // extension context gone / storage unavailable — never load-bearing (ADR-0009)
      }
    },
    async read() {
      try {
        return await port.read();
      } catch {
        return null; // storage unavailable — no Mirror row
      }
    },
    subscribe(cb) {
      let active = true;
      subscribers.add(cb);
      stopWatching ??= port.subscribe((status) => {
        for (const subscriber of subscribers) {
          try {
            subscriber(status);
          } catch {
            // One cosmetic surface cannot break status delivery to another.
          }
        }
      });
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(cb);
        if (subscribers.size === 0) {
          stopWatching?.();
          stopWatching = undefined;
        }
      };
    },
  };
}
