/**
 * The module's fail-open discipline (spec §8): every sub-read is guarded, so a
 * malformed or unexpected article degrades to a partial result and NEVER throws.
 * Shared by facets() and capture(); private to tweet-read.
 */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
