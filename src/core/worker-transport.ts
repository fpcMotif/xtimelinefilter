/**
 * Whether a real extension messaging channel is reachable. Every worker-backed
 * store (Settings, Filter, Coach, Collections) checks this the same way to
 * decide between talking to the background worker and a direct or inert
 * fallback for tests and non-extension hosts — one predicate, so the four
 * copies that used to make this same check inline can't drift apart.
 */
export function hasWorkerTransport(): boolean {
  return typeof globalThis.chrome?.runtime?.sendMessage === "function";
}
