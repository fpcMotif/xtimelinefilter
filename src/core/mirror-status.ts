/**
 * The Mirror's observable heartbeat (ADR-0009 stays intact: never load-bearing).
 * The content script publishes the last recordAssign outcome to
 * chrome.storage.local under STORAGE_KEYS.mirrorStatus; the popup renders it so
 * "is my Convex Mirror actually syncing?" is answered instantly instead of via a
 * once-only console.warn nobody sees.
 */
export interface MirrorStatus {
  ok: boolean;
  /** epoch ms when the write settled. */
  at: number;
}

/** Parse a storage.local value into a MirrorStatus; anything malformed ⇒ null. */
export function parseMirrorStatus(raw: unknown): MirrorStatus | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { ok, at } = raw as Record<string, unknown>;
  if (typeof ok !== "boolean" || typeof at !== "number") return null;
  return { ok, at };
}

/** "just now" / "3m ago" / "2h ago" — the popup's as-of cue. */
export function mirrorAgeLabel(at: number, now: number): string {
  const mins = Math.floor(Math.max(0, now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
